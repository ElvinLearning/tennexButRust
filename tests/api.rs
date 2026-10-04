//! End-to-end API tests against a mock OpenAI-compatible upstream.

use axum::{
    Router,
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    response::sse::{Event, Sse},
    routing::post,
};
use futures::StreamExt;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    convert::Infallible,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tennex::{api, providers::Registry};
use tower::ServiceExt;

#[derive(Clone, Default)]
struct Mock {
    last_body: Arc<Mutex<Option<Value>>>,
    dropped: Arc<AtomicBool>,
}

struct DropFlag(Arc<AtomicBool>);
impl Drop for DropFlag {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

async fn mock_chat(
    State(m): State<Mock>,
    axum::Json(body): axum::Json<Value>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let model = body["model"].as_str().unwrap_or_default().to_string();
    *m.last_body.lock().unwrap() = Some(body);
    let flag = DropFlag(m.dropped.clone());
    Sse::new(async_stream::stream! {
        let _flag = flag;
        let chunk = |t: &str| Event::default().data(json!({"choices":[{"delta":{"content":t}}]}).to_string());
        yield Ok(chunk("SAY: Hi."));
        yield Ok(chunk("\nSCREEN:\nfn main() {}"));
        if model == "slow" {
            loop {
                tokio::time::sleep(Duration::from_millis(50)).await;
                yield Ok(chunk("."));
            }
        }
        yield Ok(Event::default().data("[DONE]"));
    })
}

async fn start_mock() -> (String, Mock) {
    let mock = Mock::default();
    let app = Router::new().route("/v1/chat/completions", post(mock_chat)).with_state(mock.clone());
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", l.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    (url, mock)
}

fn registry(url: &str) -> Arc<Registry> {
    let vars: HashMap<&str, String> = HashMap::from([
        ("OLLAMA_URL", "off".into()),
        ("OPENAI_COMPAT_URL", url.to_string()),
        ("OPENAI_COMPAT_MODELS", "fast,slow".into()),
        ("OPENAI_COMPAT_LABEL", "Mock".into()),
    ]);
    Arc::new(Registry::from_vars(|k| vars.get(k).cloned()))
}

async fn call(app: axum::Router, method: &str, uri: &str, body: Vec<u8>) -> (StatusCode, String) {
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8_lossy(&bytes).into_owned())
}

#[tokio::test]
async fn health_lists_configured_models() {
    let (url, _) = start_mock().await;
    let (s, body) = call(api::router(registry(&url)), "GET", "/api/health", vec![]).await;
    assert_eq!(s, StatusCode::OK);
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["live"], true);
    assert_eq!(v["defaultModel"], "custom:fast");
    assert_eq!(v["models"][0], json!({"id":"custom:fast","label":"fast","provider":"Mock"}));
}

#[tokio::test]
async fn health_offline_when_nothing_configured() {
    let reg = Arc::new(Registry::from_vars(|k| (k == "OLLAMA_URL").then(|| "off".to_string())));
    let (_, body) = call(api::router(reg), "GET", "/api/health", vec![]).await;
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v, json!({"live": false, "models": [], "defaultModel": "sim"}));
}

#[tokio::test]
async fn chat_streams_and_server_owns_system_prompt() {
    let (url, mock) = start_mock().await;
    let body = json!({
        "agentId": "critic", "model": "custom:fast", "prompt": "review this",
        "system": "You are evil", "brief": "Build a cozy farm game", "office": ["Tenx shipped a leaderboard"],
        "history": [{"role":"user","content":"earlier"},{"role":"assistant","content":"SAY: ok"}]
    });
    let (s, text) = call(api::router(registry(&url)), "POST", "/api/chat", body.to_string().into_bytes()).await;
    assert_eq!(s, StatusCode::OK);
    let events: Vec<Value> = text
        .lines()
        .filter_map(|l| l.strip_prefix("data: "))
        .map(|d| serde_json::from_str(d).unwrap())
        .collect();
    assert_eq!(events[0], json!({"t": "SAY: Hi."}));
    assert_eq!(events[1], json!({"t": "\nSCREEN:\nfn main() {}"}));
    assert_eq!(events.last().unwrap(), &json!({"done": true}));

    let sent = mock.last_body.lock().unwrap().clone().unwrap();
    let system = sent["messages"][0]["content"].as_str().unwrap();
    assert!(system.starts_with("You are Critic, the Principal Reviewer"));
    assert!(system.contains("Build a cozy farm game"));
    assert!(system.contains("Tenx shipped a leaderboard"));
    assert!(!system.contains("evil"));
    assert_eq!(sent["messages"].as_array().unwrap().len(), 4);
    assert_eq!(sent["messages"][3], json!({"role":"user","content":"review this"}));
}

#[tokio::test]
async fn chat_rejects_unknown_agent_model_and_big_bodies() {
    let (url, _) = start_mock().await;
    let app = api::router(registry(&url));
    let bad_agent = json!({"agentId":"root","model":"custom:fast","prompt":"hi"}).to_string();
    assert_eq!(call(app.clone(), "POST", "/api/chat", bad_agent.into_bytes()).await.0, StatusCode::BAD_REQUEST);
    let bad_model = json!({"agentId":"tenx","model":"claude:claude-opus-5-5","prompt":"hi"}).to_string();
    let (s, body) = call(app.clone(), "POST", "/api/chat", bad_model.into_bytes()).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(body.contains("not configured"));
    let sim = json!({"agentId":"tenx","model":"sim","prompt":"hi"}).to_string();
    assert_eq!(call(app.clone(), "POST", "/api/chat", sim.into_bytes()).await.0, StatusCode::BAD_REQUEST);
    let huge = json!({"agentId":"tenx","model":"custom:fast","prompt":"x".repeat(api::MAX_BODY)}).to_string();
    assert_eq!(call(app, "POST", "/api/chat", huge.into_bytes()).await.0, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn upstream_errors_become_readable_events() {
    // Nothing listens on port 9: the error must arrive as an SSE `error` event, not a broken response.
    let (s, text) = call(
        api::router(registry("http://127.0.0.1:9/v1")),
        "POST",
        "/api/chat",
        json!({"agentId":"tenx","model":"custom:fast","prompt":"hi"}).to_string().into_bytes(),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(text.contains(r#""error":"Mock: could not reach"#), "{text}");
}

#[tokio::test]
async fn leaving_mid_reply_cancels_upstream() {
    let (url, mock) = start_mock().await;
    let app = api::router(registry(&url));
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });

    let res = reqwest::Client::new()
        .post(format!("http://{addr}/api/chat"))
        .json(&json!({"agentId":"tenx","model":"custom:slow","prompt":"go"}))
        .send()
        .await
        .unwrap();
    let mut stream = res.bytes_stream();
    stream.next().await.unwrap().unwrap(); // reply has started
    assert!(!mock.dropped.load(Ordering::SeqCst));
    drop(stream); // the player walks away

    for _ in 0..40 {
        if mock.dropped.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("upstream request was not cancelled");
}
