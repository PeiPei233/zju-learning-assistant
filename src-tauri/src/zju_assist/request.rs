use super::ZjuAssist;
use crate::utils::measure_latency;
use anyhow::{anyhow, Result};
use log::info;
use reqwest::header::{HeaderMap, USER_AGENT};
use reqwest::{Client, Error, IntoUrl, Method, RequestBuilder, Response};
use serde::Serialize;
use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

pub struct ZjuRequestBuilder {
    request_builder_first: RequestBuilder,
    request_builder_second: RequestBuilder,
}
impl ZjuRequestBuilder {
    fn new<U: IntoUrl + Clone>(
        client: ZjuAssist,
        method: Method,
        url: U,
        proxy_first: bool,
        follow_redirects: bool,
    ) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            "Mozilla/5.0 (X11; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0"
                .parse()
                .unwrap(),
        );

        let client_default = Client::builder()
            .cookie_provider(Arc::clone(&client.jar))
            .default_headers(headers.clone())
            .redirect(if follow_redirects {
                reqwest::redirect::Policy::default()
            } else {
                reqwest::redirect::Policy::none()
            })
            .build()
            .unwrap();

        let client_no_proxy = Client::builder()
            .cookie_provider(Arc::clone(&client.jar))
            .default_headers(headers)
            .redirect(if follow_redirects {
                reqwest::redirect::Policy::default()
            } else {
                reqwest::redirect::Policy::none()
            })
            .no_proxy()
            .build()
            .unwrap();
        if proxy_first {
            Self {
                request_builder_first: client_default.request(method.clone(), url.clone()),
                request_builder_second: client_no_proxy.request(method, url),
            }
        } else {
            Self {
                request_builder_first: client_no_proxy.request(method.clone(), url.clone()),
                request_builder_second: client_default.request(method, url),
            }
        }
    }

    pub fn headers(&mut self, headers: HeaderMap) -> &mut Self {
        self.request_builder_first = self
            .request_builder_first
            .try_clone()
            .unwrap()
            .headers(headers.clone());
        self.request_builder_second = self
            .request_builder_second
            .try_clone()
            .unwrap()
            .headers(headers.clone());
        self
    }

    pub fn form<T: Serialize + ?Sized>(&mut self, form: &T) -> &mut Self {
        self.request_builder_first = self.request_builder_first.try_clone().unwrap().form(form);
        self.request_builder_second = self.request_builder_second.try_clone().unwrap().form(form);
        self
    }

    pub fn json<T: Serialize + ?Sized>(&mut self, json: &T) -> &mut Self {
        self.request_builder_first = self.request_builder_first.try_clone().unwrap().json(json);
        self.request_builder_second = self.request_builder_second.try_clone().unwrap().json(json);
        self
    }

    pub fn query<T: Serialize + ?Sized>(&mut self, query: &T) -> &mut Self {
        self.request_builder_first = self.request_builder_first.try_clone().unwrap().query(query);
        self.request_builder_second = self
            .request_builder_second
            .try_clone()
            .unwrap()
            .query(query);
        self
    }

    // For single-use credentials: retry the authentication flow, not this request.
    pub async fn send_once(&self) -> Result<Response, Error> {
        self.request_builder_first.try_clone().unwrap().send().await
    }

    pub fn body(&mut self, body: String) -> &mut Self {
        self.request_builder_first = self
            .request_builder_first
            .try_clone()
            .unwrap()
            .body(body.clone());
        self.request_builder_second = self.request_builder_second.try_clone().unwrap().body(body);
        self
    }

    pub fn timeout(&mut self, timeout: Duration) -> &mut Self {
        self.request_builder_first = self
            .request_builder_first
            .try_clone()
            .unwrap()
            .timeout(timeout);
        self.request_builder_second = self
            .request_builder_second
            .try_clone()
            .unwrap()
            .timeout(timeout);
        self
    }

    pub async fn send(&self) -> Result<Response, Error> {
        // total 6 retries, 3 with proxy, 3 without proxy
        let mut res = self.request_builder_first.try_clone().unwrap().send().await;
        let mut retries = 5;
        let mut delay_time = 100;

        while res.is_err() && retries > 0 {
            retries -= 1;
            // wait for 200ms before retry
            tokio::time::sleep(Duration::from_millis(delay_time)).await;
            if retries % 2 == 0 {
                res = self
                    .request_builder_second
                    .try_clone()
                    .unwrap()
                    .send()
                    .await;
            } else {
                res = self.request_builder_first.try_clone().unwrap().send().await;
            }
            delay_time *= 2;
        }

        res
    }
}

impl ZjuAssist {
    pub fn request<U: IntoUrl + Clone>(&self, method: Method, url: U) -> ZjuRequestBuilder {
        ZjuRequestBuilder::new(
            self.clone(),
            method,
            url,
            self.proxy_first.load(Ordering::Relaxed),
            true,
        )
    }

    pub fn get<U: IntoUrl + Clone>(&self, url: U) -> ZjuRequestBuilder {
        info!("GET {}", url.as_str());
        self.request(Method::GET, url)
    }

    pub fn post<U: IntoUrl + Clone>(&self, url: U) -> ZjuRequestBuilder {
        info!("POST {}", url.as_str());
        self.request(Method::POST, url)
    }

    pub async fn test_connection(&mut self) -> Result<()> {
        let headers = HeaderMap::new();
        let client_default = Client::builder()
            .default_headers(headers.clone())
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        let client_no_proxy = Client::builder()
            .default_headers(headers)
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();

        tokio::pin! {
            let latency_default = measure_latency(client_default, "https://zdbk.zju.edu.cn/");
            let latency_no_proxy = measure_latency(client_no_proxy, "https://zdbk.zju.edu.cn/");
        }

        let latency_default_result;
        let latency_no_proxy_result;

        tokio::select! {
            res = &mut latency_default => {
                if res.is_err() {
                    // if latency_default fail, wait for latency_no_proxy
                    latency_default_result = res;
                    latency_no_proxy_result = latency_no_proxy.await;
                } else {
                    // if latency_default success, no need to wait latency_no_proxy
                    info!("Latency default: {:?}", res);
                    self.proxy_first.store(true, Ordering::Relaxed);
                    return Ok(());
                }
            },
            res = &mut latency_no_proxy => {
                if res.is_err() {
                    // if latency_no_proxy fail, wait for latency_default
                    latency_no_proxy_result = res;
                    latency_default_result = latency_default.await;
                } else {
                    // if latency_no_proxy success, no need to wait latency_default
                    info!("Latency no proxy: {:?}", res);
                    self.proxy_first.store(false, Ordering::Relaxed);
                    return Ok(());
                }
            },
        }

        let latency_default = latency_default_result;
        let latency_no_proxy = latency_no_proxy_result;

        info!("Latency default: {:?}", latency_default);
        info!("Latency no proxy: {:?}", latency_no_proxy);

        if latency_default.is_err() && latency_no_proxy.is_err() {
            return Err(anyhow!("Connection failed"));
        }
        if latency_default.is_err() {
            self.proxy_first.store(false, Ordering::Relaxed);
        } else if latency_no_proxy.is_err() {
            self.proxy_first.store(true, Ordering::Relaxed);
        } else if latency_default.unwrap() < latency_no_proxy.unwrap() {
            self.proxy_first.store(true, Ordering::Relaxed);
        } else {
            self.proxy_first.store(false, Ordering::Relaxed);
        }

        info!("Proxy first: {}", self.proxy_first.load(Ordering::Relaxed));
        Ok(())
    }

    pub(super) fn request_without_redirects<U: IntoUrl + Clone>(
        &self,
        method: Method,
        url: U,
    ) -> ZjuRequestBuilder {
        ZjuRequestBuilder::new(
            self.clone(),
            method,
            url,
            self.proxy_first.load(Ordering::Relaxed),
            false,
        )
    }
}
