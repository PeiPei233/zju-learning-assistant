use super::ZjuAssist;
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
    timeout: Option<Duration>,
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
            .connect_timeout(Duration::from_secs(15))
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
            .connect_timeout(Duration::from_secs(15))
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
                timeout: Some(Duration::from_secs(60)),
            }
        } else {
            Self {
                request_builder_first: client_no_proxy.request(method.clone(), url.clone()),
                request_builder_second: client_default.request(method, url),
                timeout: Some(Duration::from_secs(60)),
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
        self.send_request(&self.request_builder_first).await
    }

    async fn send_request(&self, builder: &RequestBuilder) -> Result<Response, Error> {
        let mut request = builder.try_clone().unwrap();
        if let Some(timeout) = self.timeout {
            request = request.timeout(timeout);
        }
        request.send().await
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
        self.timeout = Some(timeout);
        self
    }

    // Disable the total request timeout while retaining the connection timeout.
    pub fn no_timeout(&mut self) -> &mut Self {
        self.timeout = None;
        self
    }

    pub async fn send(&self) -> Result<Response, Error> {
        // total 6 retries, 3 with proxy, 3 without proxy
        let mut res = self.send_once().await;
        let mut retries = 5;
        let mut delay_time = 100;

        while res.is_err() && retries > 0 {
            retries -= 1;
            // wait for 200ms before retry
            tokio::time::sleep(Duration::from_millis(delay_time)).await;
            if retries % 2 == 0 {
                res = self.send_request(&self.request_builder_second).await;
            } else {
                res = self.send_once().await;
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
