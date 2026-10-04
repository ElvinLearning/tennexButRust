use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tennex::{api, doctor, providers::Registry};
use tower_http::services::{ServeDir, ServeFile};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    let reg = Arc::new(Registry::from_env());

    if std::env::args().nth(1).as_deref() == Some("doctor") {
        let ok = doctor::run(&reg).await;
        std::process::exit(if ok { 0 } else { 1 });
    }

    let public = PathBuf::from(std::env::var("PUBLIC_DIR").unwrap_or_else(|_| "public".into()));
    let static_files = ServeDir::new(&public).fallback(ServeFile::new(public.join("index.html")));
    let app = api::router(reg.clone()).fallback_service(static_files);

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787);
    let addr: SocketAddr = format!("{host}:{port}").parse().expect("valid HOST/PORT");

    let models = reg.models().await;
    println!("Tennex Office → http://{addr}");
    if models.is_empty() {
        println!("  no models configured: offline sim mode (see .env.example)");
    } else {
        for m in &models {
            println!("  {}  ({})", m.id, m.provider);
        }
    }

    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("server");
}
