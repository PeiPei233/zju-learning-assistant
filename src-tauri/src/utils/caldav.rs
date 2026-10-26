use crate::model::Config;
use anyhow::{anyhow, bail, Context, Result};
use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use libdav::{
    caldav::{FindCalendarHomeSet, FindCalendars, GetCalendarResources, GetSupportedComponents},
    dav::{Delete, FindPropertyHrefs, GetProperty, ListResources, PutResource},
    names,
    requests::DavRequest,
    xmlutils::XmlNode,
};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path, time::Duration};
use url::Url;

pub static EXPORT_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Serialize)]
pub struct Calendar {
    pub url: String,
    pub name: String,
    pub components: Vec<String>,
}

#[derive(Debug)]
struct HttpFailure(StatusCode);
impl std::fmt::Display for HttpFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CalDAV 请求失败（HTTP {}）", self.0)
    }
}
impl std::error::Error for HttpFailure {}

// libdav's content query does not expose filters. Extend only that request;
// keep XML generation, HTTP request setup and response parsing in libdav.
struct CalendarQuery<'a> {
    href: &'a str,
    uid: &'a str,
    component: &'a str,
    range: Option<&'a (String, String)>,
}
impl DavRequest for CalendarQuery<'_> {
    type Response = <GetCalendarResources<'static> as DavRequest>::Response;
    type ParseError = <GetCalendarResources<'static> as DavRequest>::ParseError;
    type Error<E> = <GetCalendarResources<'static> as DavRequest>::Error<E>;

    fn prepare_request(
        &self,
        base: http::Uri,
    ) -> std::result::Result<http::Request<String>, http::Error> {
        let mut request = GetCalendarResources::new(self.href).prepare_request(base)?;
        let prop = XmlNode::new(&names::PROP).with_children(vec![
            XmlNode::new(&names::GETETAG),
            XmlNode::new(&names::CALENDAR_DATA),
        ]);
        let text_match = libdav::PropertyName::new(names::CALDAV, "text-match");
        let uid = XmlNode::new(&names::PROP_FILTER)
            .with_attributes(vec![("name", "UID")])
            .with_children(vec![XmlNode::new(&text_match)
                .with_attributes(vec![("collation", "i;octet")])
                .with_text(self.uid)]);
        let mut filters = Vec::new();
        if let Some((start, end)) = self.range {
            filters.push(
                XmlNode::new(&names::TIME_RANGE)
                    .with_attributes(vec![("start", start), ("end", end)]),
            );
        }
        filters.push(uid);
        let event = XmlNode::new(&names::COMP_FILTER)
            .with_attributes(vec![("name", self.component)])
            .with_children(filters);
        let filter =
            XmlNode::new(&names::FILTER).with_children(vec![XmlNode::new(&names::COMP_FILTER)
                .with_attributes(vec![("name", "VCALENDAR")])
                .with_children(vec![event])]);
        *request.body_mut() = XmlNode::new(&names::CALENDAR_QUERY)
            .with_children(vec![prop, filter])
            .render_node();
        Ok(request)
    }
    fn parse_response(
        &self,
        parts: &http::response::Parts,
        body: &[u8],
    ) -> std::result::Result<Self::Response, Self::ParseError> {
        GetCalendarResources::new(self.href).parse_response(parts, body)
    }
}

// Some servers omit existing resources from REPORT results. Read our known
// creation address before treating a missing query result as a new resource.
struct GetResource<'a>(&'a str);
impl DavRequest for GetResource<'_> {
    type Response = (String, String);
    type ParseError = std::str::Utf8Error;
    type Error<E> = <GetCalendarResources<'static> as DavRequest>::Error<E>;

    fn prepare_request(
        &self,
        base: http::Uri,
    ) -> std::result::Result<http::Request<String>, http::Error> {
        let mut request = GetCalendarResources::new(self.0).prepare_request(base)?;
        *request.method_mut() = http::Method::GET;
        request.headers_mut().remove("Depth");
        request.headers_mut().remove(http::header::CONTENT_TYPE);
        request.body_mut().clear();
        Ok(request)
    }
    fn parse_response(
        &self,
        parts: &http::response::Parts,
        body: &[u8],
    ) -> std::result::Result<Self::Response, Self::ParseError> {
        let etag = parts
            .headers
            .get(http::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        Ok((etag.to_owned(), std::str::from_utf8(body)?.to_owned()))
    }
}

struct Connection {
    client: Client,
    base: Url,
    config: Config,
}
impl Connection {
    fn new(config: &Config) -> Result<Self> {
        if config.caldav_server.trim().is_empty()
            || config.caldav_username.trim().is_empty()
            || config.caldav_password.is_empty()
        {
            bail!("请先前往“设置 → 下载与同步 → CalDAV”，填写服务器地址、用户名和密码");
        }
        let server = config.caldav_server.trim();
        let base = Url::parse(&if server.contains("://") {
            server.to_owned()
        } else {
            format!("https://{server}")
        })?;
        if !matches!(base.scheme(), "http" | "https")
            || !base.username().is_empty()
            || base.password().is_some()
        {
            bail!("请输入不含账号信息的 http 或 https 服务器地址");
        }
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            .build()?;
        Ok(Self {
            client,
            base,
            config: config.clone(),
        })
    }
    fn resolve(&self, base: &Url, href: &str) -> Result<Url> {
        let url = base.join(href)?;
        if url.origin() != self.base.origin()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            bail!("CalDAV 返回了不同服务器的地址，请直接填写该服务器地址后重新连接");
        }
        Ok(url)
    }
    // libdav owns DAV request construction and response parsing; retain the app's
    // reqwest transport for proxy support, timeouts and credential-safe redirects.
    async fn send<R: DavRequest>(&self, request: R) -> Result<R::Response>
    where
        R::ParseError: std::fmt::Display,
    {
        let prepared = request.prepare_request(self.base.as_str().parse()?)?;
        let (parts, body) = prepared.into_parts();
        let mut target = self.resolve(&self.base, &parts.uri.to_string())?;
        for _ in 0..6 {
            let response = self
                .client
                .request(parts.method.clone(), target.clone())
                .headers(parts.headers.clone())
                .basic_auth(
                    self.config.caldav_username.trim(),
                    Some(&self.config.caldav_password),
                )
                .body(body.clone())
                .send()
                .await
                .map_err(|e| e.without_url())?;
            let status = response.status();
            if status.is_redirection() {
                let location = response
                    .headers()
                    .get(http::header::LOCATION)
                    .ok_or_else(|| anyhow!("CalDAV 重定向缺少地址"))?
                    .to_str()?;
                target = self.resolve(&target, location)?;
                continue;
            }
            if !status.is_success() {
                return Err(HttpFailure(status).into());
            }
            let mut envelope = http::Response::builder().status(status);
            *envelope.headers_mut().unwrap() = response.headers().clone();
            let (parts, _) = envelope.body(())?.into_parts();
            let body = response.bytes().await.map_err(|e| e.without_url())?;
            return request
                .parse_response(&parts, &body)
                .map_err(|e| anyhow!("CalDAV 响应解析失败：{e}"));
        }
        bail!("CalDAV 重定向次数过多")
    }
    async fn query(
        &self,
        calendar: &Url,
        uid: &str,
        component: &str,
        range: &(String, String),
    ) -> Result<Vec<Resource>> {
        let response = self
            .send(CalendarQuery {
                href: calendar.path(),
                uid,
                component,
                range: (self.base.host_str() == Some("calendar.dingtalk.com")
                    && component == "VEVENT")
                    .then_some(range),
            })
            .await?;
        let mut matches = Vec::new();
        for resource in response.resources {
            let data = match resource.content {
                Ok(data) => data,
                Err(StatusCode::NOT_FOUND | StatusCode::GONE) => continue,
                Err(status) => bail!("读取日历条目失败（HTTP {status}）"),
            };
            if unfold(&data.data)
                .lines()
                .any(|line| line == format!("BEGIN:{component}"))
            {
                matches.push(Resource {
                    url: self.resolve(calendar, &resource.href)?,
                    etag: data.etag,
                    data: data.data,
                });
            }
        }
        Ok(matches)
    }
    async fn find(
        &self,
        calendar: &Url,
        uid: &str,
        component: &str,
        range: &(String, String),
    ) -> Result<Option<Resource>> {
        let mut matches: Vec<_> = self
            .query(calendar, uid, component, range)
            .await?
            .into_iter()
            .filter(|r| value(&r.data, "UID").as_deref() == Some(uid))
            .collect();
        if matches.len() > 1 {
            bail!("发现多个相同标识的日历条目，请先检查目标日历");
        }
        if let Some(resource) = matches.pop() {
            return Ok(Some(resource));
        }
        let url = calendar.join(&format!("{uid}.ics"))?;
        match self.send(GetResource(url.path())).await {
            Ok((etag, data)) => {
                if value(&data, "UID").as_deref() != Some(uid)
                    || !unfold(&data)
                        .lines()
                        .any(|line| line == format!("BEGIN:{component}"))
                {
                    bail!("目标地址已有其他内容，已停止导出以避免覆盖");
                }
                Ok(Some(Resource { url, etag, data }))
            }
            Err(error)
                if error
                    .downcast_ref::<HttpFailure>()
                    .is_some_and(|e| matches!(e.0, StatusCode::NOT_FOUND | StatusCode::GONE)) =>
            {
                Ok(None)
            }
            Err(error) => Err(error.context("读取已有条目失败")),
        }
    }
}

pub async fn connect(config: &Config) -> Result<Vec<Calendar>> {
    let connection = Connection::new(config)?;
    let principals = match connection
        .send(FindPropertyHrefs::new(
            connection.base.path(),
            &names::CURRENT_USER_PRINCIPAL,
        ))
        .await
    {
        Ok(result) if !result.hrefs.is_empty() => result,
        _ => {
            connection
                .send(FindPropertyHrefs::new(
                    "/.well-known/caldav",
                    &names::CURRENT_USER_PRINCIPAL,
                ))
                .await?
        }
    };
    let principal = principals
        .hrefs
        .first()
        .ok_or_else(|| anyhow!("未找到 CalDAV 账号入口"))?;
    let principal = connection.resolve(&connection.base, &principal.to_string())?;
    let homes = connection
        .send(FindCalendarHomeSet::new(principal.path()))
        .await?;
    let mut calendars = Vec::new();
    for home in homes.home_sets {
        let home = connection.resolve(&connection.base, &home.to_string())?;
        for collection in connection
            .send(FindCalendars::new(home.path()))
            .await?
            .calendars
        {
            let url = connection.resolve(&home, &collection.href)?;
            let name = connection
                .send(GetProperty::new(url.path(), &names::DISPLAY_NAME))
                .await?
                .value
                .unwrap_or_else(|| "未命名日历".into());
            let components = connection
                .send(GetSupportedComponents::new(url.path()))
                .await?
                .components
                .iter()
                .map(|c| c.as_str().to_owned())
                .collect();
            if !calendars.iter().any(|c: &Calendar| c.url == url.as_str()) {
                calendars.push(Calendar {
                    url: url.to_string(),
                    name,
                    components,
                });
            }
        }
    }
    if calendars.is_empty() {
        bail!("没有找到可用的日历或待办列表");
    }
    Ok(calendars)
}

#[derive(Clone)]
struct Resource {
    url: Url,
    etag: String,
    data: String,
}

#[derive(Deserialize)]
struct LegacyRecord {
    uid: String,
    obsolete: Vec<String>,
}

fn unfold(data: &str) -> String {
    data.replace("\r\n", "\n")
        .replace("\n ", "")
        .replace("\n\t", "")
}
fn property(data: &str, name: &str) -> Option<(String, String)> {
    let mut depth = 0;
    let mut active = false;
    for line in unfold(data).lines() {
        if line == "BEGIN:VEVENT" || line == "BEGIN:VTODO" {
            active = true;
            depth = 1;
            continue;
        }
        if !active {
            continue;
        }
        if line.starts_with("BEGIN:") {
            depth += 1;
        }
        if line.starts_with("END:") {
            depth -= 1;
            if depth == 0 {
                break;
            }
        }
        if depth == 1 {
            if let Some((key, value)) = line.split_once(':') {
                if key.split(';').next() == Some(name) {
                    return Some((key.into(), value.into()));
                }
            }
        }
    }
    None
}
fn value(data: &str, name: &str) -> Option<String> {
    property(data, name).map(|(_, value)| value)
}
fn matching_fields(data: &str, fields: &[String], dingtalk: bool) -> bool {
    fields.iter().all(|field| {
        let (name, expected) = field.split_once(':').unwrap();
        let actual = property(data, name);
        // DingTalk omits these optional properties on round-trip. Keep sending them,
        // but do not repeatedly update an otherwise identical event to restore them.
        if dingtalk && matches!(name, "LOCATION" | "URL") && actual.is_none() {
            return true;
        }
        let Some((key, actual)) = actual else {
            return false;
        };
        if matches!(name, "DTSTART" | "DTEND" | "DUE") {
            let expected = NaiveDateTime::parse_from_str(expected, "%Y%m%dT%H%M%SZ")
                .ok()
                .map(|t| t.and_utc());
            let time = if actual.ends_with('Z') {
                NaiveDateTime::parse_from_str(&actual, "%Y%m%dT%H%M%SZ")
                    .ok()
                    .map(|t| t.and_utc())
            } else {
                key.split(';')
                    .find_map(|p| p.strip_prefix("TZID="))
                    .and_then(|tz| tz.trim_matches('"').parse::<chrono_tz::Tz>().ok())
                    .and_then(|tz| {
                        NaiveDateTime::parse_from_str(&actual, "%Y%m%dT%H%M%S")
                            .ok()
                            .and_then(|t| tz.from_local_datetime(&t).single())
                            .map(|t| t.with_timezone(&Utc))
                    })
            };
            expected.is_some() && time == expected
        } else {
            actual == expected
        }
    }) && (fields.iter().any(|f| f.starts_with("DUE:")) || value(data, "DUE").is_none())
}
fn escape(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('\r', "")
        .replace('\n', "\\n")
        .replace(';', "\\;")
        .replace(',', "\\,")
}
fn uuid(seed: &str) -> String {
    let hash = format!("{:x}", md5::compute(seed));
    format!(
        "{}-{}-{}-{}-{}",
        &hash[..8],
        &hash[8..12],
        &hash[12..16],
        &hash[16..20],
        &hash[20..]
    )
}

fn fields(todo: &Value, component: &str) -> Result<Vec<String>> {
    let title = todo["title"]
        .as_str()
        .ok_or_else(|| anyhow!("待办缺少标题"))?;
    let id = todo["id"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| todo["id"].to_string());
    let course = todo["course_id"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| todo["course_id"].to_string());
    if id == "null" || course == "null" {
        bail!("待办缺少课程或任务标识");
    }
    let mut fields = vec![
        format!("SUMMARY:{}", escape(title)),
        format!(
            "LOCATION:{}",
            escape(todo["course_name"].as_str().unwrap_or(""))
        ),
        format!(
            "URL:https://courses.zju.edu.cn/course/{}/learning-activity#/{}?view=scores",
            url::form_urlencoded::byte_serialize(course.as_bytes()).collect::<String>(),
            url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>()
        ),
    ];
    if let Some(deadline) = todo["end_time"].as_str() {
        let date = DateTime::parse_from_rfc3339(deadline)
            .map_err(|_| anyhow!("待办截止时间格式不正确"))?
            .with_timezone(&Utc)
            .format("%Y%m%dT%H%M%SZ")
            .to_string();
        if component == "VEVENT" {
            fields.push(format!("DTSTART:{date}"));
            fields.push(format!("DTEND:{date}"));
        } else {
            fields.push(format!("DUE:{date}"));
        }
    } else if component == "VEVENT" {
        bail!("日历日程需要截止时间");
    }
    Ok(fields)
}

fn content(uid: &str, component: &str, fields: &[String], previous: Option<&str>) -> String {
    let now = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let updates = [
        fields.to_vec(),
        vec![
            format!("UID:{uid}"),
            format!("DTSTAMP:{now}"),
            format!("LAST-MODIFIED:{now}"),
        ],
    ]
    .concat();
    let alarm = [
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:待办截止提醒",
        if component == "VTODO" {
            "TRIGGER;RELATED=END:-PT1H"
        } else {
            "TRIGGER:-PT1H"
        },
        "END:VALARM",
    ];
    let has_deadline = fields
        .iter()
        .any(|f| f.starts_with("DTSTART:") || f.starts_with("DUE:"));
    let lines = if let Some(previous) = previous {
        let mut result = Vec::new();
        let mut depth = 0;
        let mut skip_alarm = false;
        let unfolded = unfold(previous);
        let lines: Vec<_> = unfolded.lines().collect();
        for (index, &line) in lines.iter().enumerate() {
            if line == format!("BEGIN:{component}") {
                depth = 1;
                result.push(line.to_owned());
                result.extend(updates.clone());
                continue;
            }
            if depth == 1
                && line == "BEGIN:VALARM"
                && component == "VTODO"
                && !fields.iter().any(|f| f.starts_with("DUE:"))
            {
                skip_alarm = lines[index + 1..]
                    .iter()
                    .take_while(|line| **line != "END:VALARM")
                    .any(|line| {
                        let Some((key, _)) = line.split_once(':') else {
                            return false;
                        };
                        let mut parts = key.split(';');
                        parts.next() == Some("TRIGGER")
                            && parts.clone().any(|p| p.eq_ignore_ascii_case("RELATED=END"))
                            && !parts.any(|p| p.eq_ignore_ascii_case("VALUE=DATE-TIME"))
                    });
            }
            if skip_alarm {
                if line == "END:VALARM" {
                    skip_alarm = false;
                }
                continue;
            }
            if depth > 0 && line.starts_with("BEGIN:") {
                depth += 1;
            }
            let key = line.split([':', ';']).next().unwrap_or("");
            if depth != 1
                || ![
                    "UID",
                    "SUMMARY",
                    "LOCATION",
                    "URL",
                    "DTSTART",
                    "DTEND",
                    "DUE",
                    "DTSTAMP",
                    "LAST-MODIFIED",
                ]
                .contains(&key)
            {
                result.push(line.to_owned());
            }
            if depth > 0 && line.starts_with("END:") {
                depth -= 1;
            }
        }
        if component == "VTODO"
            && has_deadline
            && value(previous, "DUE").is_none()
            && !result.iter().any(|line| line == "BEGIN:VALARM")
        {
            if let Some(end) = result.iter().position(|line| line == "END:VTODO") {
                result.splice(end..end, alarm.iter().map(|line| (*line).to_owned()));
            }
        }
        result
    } else {
        let mut result = vec![
            "BEGIN:VCALENDAR".into(),
            "VERSION:2.0".into(),
            "PRODID:-//ZJU Learning Assistant//CalDAV//EN".into(),
            format!("BEGIN:{component}"),
            format!("CREATED:{now}"),
        ];
        result.extend(updates);
        if component == "VTODO" {
            result.push("STATUS:NEEDS-ACTION".into());
        }
        if has_deadline {
            result.extend(alarm.iter().map(|line| (*line).to_owned()));
        }
        result.push(format!("END:{component}"));
        result.push("END:VCALENDAR".into());
        result
    };
    let mut output = String::new();
    for line in lines {
        let mut bytes = 0;
        for ch in line.chars() {
            if bytes + ch.len_utf8() > 75 {
                output.push_str("\r\n ");
                bytes = 1;
            }
            output.push(ch);
            bytes += ch.len_utf8();
        }
        output.push_str("\r\n");
    }
    output
}

pub async fn export(
    config: &Config,
    scope: &str,
    todos: Vec<Value>,
    component: &str,
    legacy_path: &Path,
) -> Result<String> {
    let connection = Connection::new(config)?;
    let selected = if component == "VEVENT" {
        &config.caldav_calendar
    } else {
        &config.caldav_task_list
    };
    if selected.is_empty() {
        bail!("请先前往“设置 → 下载与同步 → CalDAV”，选择目标日历或待办列表");
    }
    let calendars = connect(config).await?;
    if !calendars
        .iter()
        .any(|c| &c.url == selected && c.components.iter().any(|c| c == component))
    {
        bail!("目标列表不可用或不支持此导出类型，请重新连接并选择");
    }
    let calendar = connection.resolve(&connection.base, selected)?;
    // Read older export journals only to locate UIDs that predate the stable prefix.
    // New exports and replacement retries use the remote collection exclusively.
    let legacy_records: BTreeMap<String, LegacyRecord> = match std::fs::read(legacy_path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| anyhow!("CalDAV 导出记录读取失败，已停止导出以避免重复创建"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
        Err(e) => return Err(e.into()),
    };
    let mut start = "19700101T000000Z".to_owned();
    let mut end = "21000101T000000Z".to_owned();
    for todo in &todos {
        if let Some(date) = todo["end_time"]
            .as_str()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        {
            let date = date.with_timezone(&Utc);
            start = start.min(
                (date - chrono::Duration::days(1))
                    .format("%Y%m%dT%H%M%SZ")
                    .to_string(),
            );
            end = end.max(
                (date + chrono::Duration::days(1))
                    .format("%Y%m%dT%H%M%SZ")
                    .to_string(),
            );
        }
    }
    let range = (start, end);
    let dingtalk = connection.base.host_str() == Some("calendar.dingtalk.com");
    let mut collection: Option<BTreeMap<String, Resource>> = None;
    let mut success = 0;
    let mut errors = Vec::new();
    for todo in todos {
        if component == "VEVENT" && todo["end_time"].is_null() {
            continue;
        }
        let result: Result<()> = async {
            let fields = fields(&todo, component)?;
            let key = key_for(&todo, scope, config, &calendar, component);
            let prefix = format!("{key}--");
            let mut existing: Vec<_> = connection
                .query(&calendar, &key, component, &range)
                .await
                .context("查询已有条目失败")?
                .into_iter()
                .filter(|r| {
                    value(&r.data, "UID").is_some_and(|uid| uid == key || uid.starts_with(&prefix))
                })
                .collect();
            // Older replacements used unrelated UIDs. Keep those discoverable
            // without creating or updating a local journal.
            let mut known = vec![key.clone()];
            if let Some(record) = legacy_records.get(&key) {
                known.push(record.uid.clone());
                known.extend(record.obsolete.iter().cloned());
            }
            known.sort();
            known.dedup();
            for uid in known {
                if !existing
                    .iter()
                    .any(|r| value(&r.data, "UID").as_deref() == Some(&uid))
                {
                    if let Some(resource) =
                        connection.find(&calendar, &uid, component, &range).await?
                    {
                        existing.push(resource);
                    }
                }
            }
            if existing.is_empty() {
                // UID queries can omit replacements. Enumerate the collection and
                // read the actual resources before deciding this is a new todo.
                // Do not infer UIDs from hrefs: servers may rename resources.
                if collection.is_none() {
                    let listed = connection
                        .send(ListResources::new(calendar.path()))
                        .await
                        .context("核对已有日历条目失败，未创建新条目")?;
                    let mut resources = BTreeMap::new();
                    for resource in listed.resources {
                        if resource.status.is_some_and(|status| !status.is_success()) {
                            bail!("无法完整读取目标日历，未创建新条目，请稍后重试");
                        }
                        if resource.resource_type.is_collection {
                            continue;
                        }
                        let url = connection.resolve(&calendar, &resource.href)?;
                        let (etag, data) = connection
                            .send(GetResource(url.path()))
                            .await
                            .context("核对已有日历条目失败，未创建新条目")?;
                        if value(&data, "UID").is_none() {
                            bail!("日历条目缺少标识，未创建新条目");
                        }
                        resources.insert(url.to_string(), Resource { url, etag, data });
                    }
                    // Publish only a complete snapshot; reuse it for this export.
                    collection = Some(resources);
                }
                for resource in collection.as_ref().unwrap().values() {
                    if value(&resource.data, "UID").is_some_and(|uid| {
                        uid == key
                            || uid.starts_with(&prefix)
                            || legacy_records.get(&key).is_some_and(|record| {
                                record.uid == uid || record.obsolete.contains(&uid)
                            })
                    }) && unfold(&resource.data)
                        .lines()
                        .any(|line| line == format!("BEGIN:{component}"))
                    {
                        // Refresh only matching resources, including their current ETag.
                        // Other clients may have changed them since the snapshot.
                        let (etag, data) = connection
                            .send(GetResource(resource.url.path()))
                            .await
                            .context("读取已有条目失败")?;
                        if value(&data, "UID") != value(&resource.data, "UID") {
                            bail!("已有条目标识发生变化，请重试导出");
                        }
                        existing.push(Resource {
                            url: resource.url.clone(),
                            etag,
                            data,
                        });
                    }
                }
            }
            existing.sort_by(|a, b| {
                value(&b.data, "LAST-MODIFIED")
                    .cmp(&value(&a.data, "LAST-MODIFIED"))
                    .then_with(|| a.url.as_str().cmp(b.url.as_str()))
            });
            existing.dedup_by(|a, b| a.url == b.url);
            let unchanged = existing
                .iter()
                .position(|r| matching_fields(&r.data, &fields, dingtalk));
            let previous = if existing.is_empty() {
                None
            } else {
                Some(existing.remove(unchanged.unwrap_or(0)))
            };
            let mut uid = previous
                .as_ref()
                .and_then(|r| value(&r.data, "UID"))
                .unwrap_or_else(|| key.clone());
            if unchanged.is_none() {
                let data = content(
                    &uid,
                    component,
                    &fields,
                    previous.as_ref().map(|r| r.data.as_str()),
                );
                let url = match &previous {
                    Some(r) => r.url.clone(),
                    None => calendar.join(&format!("{uid}.ics"))?,
                };
                let written = match &previous {
                    Some(r) if !r.etag.is_empty() => {
                        connection
                            .send(PutResource::new(url.path()).update(
                                &data,
                                "text/calendar; charset=utf-8",
                                &r.etag,
                            ))
                            .await
                    }
                    Some(_) => bail!("服务器没有提供条目版本信息，无法安全更新"),
                    None => {
                        connection
                            .send(
                                PutResource::new(url.path())
                                    .create(&data, "text/calendar; charset=utf-8"),
                            )
                            .await
                    }
                };
                let unsupported = written
                    .as_ref()
                    .err()
                    .and_then(|e| e.downcast_ref::<HttpFailure>())
                    .is_some_and(|e| matches!(e.0.as_u16(), 405 | 501));
                if previous.is_some() && unsupported {
                    // Keep the todo identity in every replacement UID. Deriving the
                    // suffix from the old UID also avoids reusing deleted UIDs.
                    uid = format!("{prefix}{}", uuid(&format!("{uid}|{}", fields.join("\n"))));
                    if let Some(current) =
                        connection.find(&calendar, &uid, component, &range).await?
                    {
                        if !matching_fields(&current.data, &fields, dingtalk) {
                            bail!("替换条目内容不一致，请稍后重试");
                        }
                    } else {
                        let data = content(
                            &uid,
                            component,
                            &fields,
                            previous.as_ref().map(|r| r.data.as_str()),
                        );
                        let url = calendar.join(&format!("{uid}.ics"))?;
                        let response = connection
                            .send(
                                PutResource::new(url.path())
                                    .create(&data, "text/calendar; charset=utf-8"),
                            )
                            .await
                            .context("创建替换条目失败")?;
                        if let Some(resources) = &mut collection {
                            resources.insert(
                                url.to_string(),
                                Resource {
                                    url,
                                    etag: response.etag.unwrap_or_default(),
                                    data,
                                },
                            );
                        }
                    }
                    existing.push(previous.unwrap());
                } else {
                    let response = written.context(if previous.is_some() {
                        "修改条目失败"
                    } else {
                        "创建条目失败"
                    })?;
                    if let Some(resources) = &mut collection {
                        resources.insert(
                            url.to_string(),
                            Resource {
                                url,
                                etag: response.etag.unwrap_or_default(),
                                data,
                            },
                        );
                    }
                }
            }
            if existing.is_empty() {
                return Ok(());
            }
            // Only replacement cleanup needs read-back: never remove the old
            // entry before the desired contents are visible on the server.
            let current = connection
                .find(&calendar, &uid, component, &range)
                .await?
                .ok_or_else(|| anyhow!("写入后暂未读取到条目，请稍后重试确认"))?;
            if !matching_fields(&current.data, &fields, dingtalk) {
                bail!("服务器尚未保存本次修改，请稍后重试");
            }
            if let Some(resources) = &mut collection {
                resources.insert(current.url.to_string(), current.clone());
            }
            for old in existing {
                if old.url == current.url {
                    continue;
                }
                if old.etag.is_empty() {
                    bail!("新版已保存，但旧条目缺少版本信息，未删除");
                }
                connection
                    .send(Delete::new(old.url.path()).with_etag(&old.etag))
                    .await?;
                let old_uid = value(&old.data, "UID").ok_or_else(|| anyhow!("旧条目缺少标识"))?;
                if connection
                    .find(&calendar, &old_uid, component, &range)
                    .await?
                    .is_some()
                {
                    bail!("新版已保存，旧条目尚未清理，请稍后重试");
                }
                if let Some(resources) = &mut collection {
                    resources.remove(old.url.as_str());
                }
            }
            Ok(())
        }
        .await;
        match result {
            Ok(()) => success += 1,
            Err(e) => {
                // A failed request may still have changed the server. Do not reuse
                // an uncertain snapshot for the remaining todos.
                collection = None;
                errors.push(format!(
                    "{}：{e:#}",
                    todo["title"].as_str().unwrap_or("未命名待办")
                ));
            }
        }
    }
    if errors.is_empty() {
        Ok(format!("已导出 {success} 项待办，重复条目不会再次创建。"))
    } else {
        bail!(
            "成功 {success} 项，失败 {} 项。\n{}",
            errors.len(),
            errors.into_iter().take(5).collect::<Vec<_>>().join("\n")
        )
    }
}

fn key_for(todo: &Value, scope: &str, config: &Config, calendar: &Url, component: &str) -> String {
    uuid(&format!(
        "{}|{}|{}|{}|{}|{}",
        scope,
        config.caldav_username.trim(),
        calendar,
        component,
        todo["course_id"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| todo["course_id"].to_string()),
        todo["id"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| todo["id"].to_string())
    ))
}
