use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor as LettreExecutor};
use log::debug;

pub async fn send_email(
    to: &str,
    subject: &str,
    body: &str,
    smtp_host: &str,
    smtp_port: u16,
    smtp_username: &str,
    smtp_password: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    debug!("Preparing to send email to {}", to);
    let email = Message::builder()
        .from(format!("ZJU Learning Assistant <{}>", smtp_username).parse()?)
        .to(to.parse()?)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_string())?;

    debug!("Sending email to {}", to);

    let tls_parameters = TlsParameters::new(smtp_host.to_string())?;
    let tls = if smtp_port == 465 {
        Tls::Wrapper(tls_parameters)
    } else {
        Tls::Opportunistic(tls_parameters)
    };

    let mailer: AsyncSmtpTransport<LettreExecutor> =
        AsyncSmtpTransport::<LettreExecutor>::relay(smtp_host)?
            .port(smtp_port)
            .credentials(Credentials::new(
                smtp_username.to_string(),
                smtp_password.to_string(),
            ))
            .tls(tls)
            .build();

    debug!("Email transport built, sending email now");

    match mailer.send(email).await {
        Ok(_) => Ok(()),
        Err(e) => Err(Box::new(e)),
    }
}
