//! Model providers. Every model id is `<provider>:<model>`, e.g. `nous:Hermes-4-70B`.
//! Claude speaks the Anthropic Messages API; everything else speaks OpenAI chat completions.

use crate::sse::SseDecoder;
use futures::{Stream, StreamExt};
use serde::Serialize;
use serde_json::{Value, json};
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Anthropic,
    OpenAi,
}

#[derive(Clone, Debug)]
pub struct Provider {
    /// Prefix used in model ids (`claude`, `nous`, `ollama`, `openrouter`, `custom`).
    pub key: &'static str,
    pub label: String,
    pub kind: Kind,
    pub base_url: String,
    pub api_key: Option<String>,
    /// Fixed model list. Empty for Ollama, whose models are discovered live.
    pub models: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub provider: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Msg {
    pub role: &'static str, // "user" | "assistant"
    pub content: String,
}

pub struct Registry {
    pub providers: Vec<Provider>,
    pub default_model: Option<String>,
    pub claude_effort: Option<String>,
    http: reqwest::Client,
}

fn list(v: Option<String>, default: &str) -> Vec<String> {
    v.filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn nonempty(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn trim_url(s: String) -> String {
    s.trim_end_matches('/').to_string()
}

impl Registry {
    pub fn from_env() -> Self {
        Self::from_vars(|k| std::env::var(k).ok())
    }

    pub fn from_vars(get: impl Fn(&str) -> Option<String>) -> Self {
        let mut providers = Vec::new();

        if let Some(key) = nonempty(get("ANTHROPIC_API_KEY")) {
            providers.push(Provider {
                key: "claude",
                label: "Claude".into(),
                kind: Kind::Anthropic,
                base_url: trim_url(
                    nonempty(get("ANTHROPIC_BASE_URL")).unwrap_or("https://api.anthropic.com".into()),
                ),
                api_key: Some(key),
                models: list(get("ANTHROPIC_MODELS"), "claude-opus-5-5,claude-sonnet-5-5,claude-haiku-4-5"),
            });
        }
        if let Some(key) = nonempty(get("NOUS_API_KEY")) {
            providers.push(Provider {
                key: "nous",
                label: "Nous Research (Hermes)".into(),
                kind: Kind::OpenAi,
                base_url: trim_url(
                    nonempty(get("NOUS_BASE_URL"))
                        .unwrap_or("https://inference-api.nousresearch.com/v1".into()),
                ),
                api_key: Some(key),
                models: list(get("NOUS_MODELS"), "Hermes-4-70B,Hermes-4-405B"),
            });
        }
        let ollama = nonempty(get("OLLAMA_URL")).unwrap_or("http://localhost:11434".into());
        if !matches!(ollama.as_str(), "off" | "false" | "0") {
            providers.push(Provider {
                key: "ollama",
                label: "Ollama (local)".into(),
                kind: Kind::OpenAi,
                base_url: trim_url(ollama),
                api_key: None,
                models: vec![],
            });
        }
        if let Some(key) = nonempty(get("OPENROUTER_API_KEY")) {
            providers.push(Provider {
                key: "openrouter",
                label: "OpenRouter".into(),
                kind: Kind::OpenAi,
                base_url: "https://openrouter.ai/api/v1".into(),
                api_key: Some(key),
                models: list(get("OPENROUTER_MODELS"), "openrouter/auto"),
            });
        }
        if let Some(url) = nonempty(get("OPENAI_COMPAT_URL")) {
            let models = list(get("OPENAI_COMPAT_MODELS"), "");
            if !models.is_empty() {
                providers.push(Provider {
                    key: "custom",
                    label: nonempty(get("OPENAI_COMPAT_LABEL")).unwrap_or("OpenAI-compatible".into()),
                    kind: Kind::OpenAi,
                    base_url: trim_url(url),
                    api_key: nonempty(get("OPENAI_COMPAT_KEY")),
                    models,
                });
            }
        }

        Registry {
            providers,
            default_model: nonempty(get("DEFAULT_MODEL")),
            claude_effort: match nonempty(get("CLAUDE_EFFORT")).as_deref() {
                Some("none" | "off") => None,
                Some(e) => Some(e.to_string()),
                None => Some("low".into()), // snappy spoken replies
            },
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .build()
                .expect("http client"),
        }
    }

    pub fn provider(&self, key: &str) -> Option<&Provider> {
        self.providers.iter().find(|p| p.key == key)
    }

    /// Ollama models, or an empty list if Ollama isn't running (never an error).
    async fn ollama_models(&self, p: &Provider) -> Vec<String> {
        let res = self
            .http
            .get(format!("{}/api/tags", p.base_url))
            .timeout(Duration::from_millis(1200))
            .send()
            .await;
        let Ok(res) = res else { return vec![] };
        let Ok(body) = res.json::<Value>().await else { return vec![] };
        body["models"]
            .as_array()
            .map(|a| a.iter().filter_map(|m| m["name"].as_str().map(String::from)).collect())
            .unwrap_or_default()
    }

    pub async fn models_for(&self, p: &Provider) -> Vec<String> {
        if p.key == "ollama" {
            self.ollama_models(p).await
        } else {
            p.models.clone()
        }
    }

    /// Every model that is configured and reachable.
    pub async fn models(&self) -> Vec<ModelInfo> {
        let mut out = Vec::new();
        for p in &self.providers {
            for m in self.models_for(p).await {
                out.push(ModelInfo {
                    id: format!("{}:{}", p.key, m),
                    label: m.clone(),
                    provider: p.label.clone(),
                });
            }
        }
        out
    }

    pub fn pick_default(&self, models: &[ModelInfo]) -> String {
        match &self.default_model {
            Some(d) if models.iter().any(|m| &m.id == d) => d.clone(),
            _ => models.first().map(|m| m.id.clone()).unwrap_or_else(|| "sim".into()),
        }
    }

    /// Resolve `<provider>:<model>` to a configured provider and model name.
    pub async fn resolve(&self, id: &str) -> Option<(Provider, String)> {
        let (key, model) = id.split_once(':')?;
        let p = self.provider(key)?;
        if self.models_for(p).await.iter().any(|m| m == model) {
            Some((p.clone(), model.to_string()))
        } else {
            None
        }
    }

    pub fn build_request(&self, p: &Provider, model: &str, system: &str, msgs: &[Msg]) -> reqwest::RequestBuilder {
        match p.kind {
            Kind::Anthropic => {
                let mut body = json!({
                    "model": model,
                    "max_tokens": 16000,
                    "stream": true,
                    "system": system,
                    "messages": msgs.iter().map(|m| json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
                });
                let mut req = self
                    .http
                    .post(format!("{}/v1/messages", p.base_url))
                    .header("x-api-key", p.api_key.clone().unwrap_or_default())
                    .header("anthropic-version", "2023-06-01");
                // Effort is not accepted by Haiku 4.5.
                if let Some(e) = &self.claude_effort
                    && !model.contains("haiku")
                {
                    body["output_config"] = json!({ "effort": e });
                }
                // Server-side refusal fallback on the models that support the default routing form.
                if ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"].contains(&model) {
                    body["fallbacks"] = json!("default");
                    req = req.header("anthropic-beta", "server-side-fallback-2026-07-01");
                }
                req.json(&body)
            }
            Kind::OpenAi => {
                let mut messages = vec![json!({"role": "system", "content": system})];
                messages.extend(msgs.iter().map(|m| json!({"role": m.role, "content": m.content})));
                let mut req = self
                    .http
                    .post(format!("{}{}", p.base_url, openai_path(p)))
                    .json(&json!({ "model": model, "stream": true, "messages": messages }));
                if let Some(k) = &p.api_key {
                    req = req.bearer_auth(k);
                }
                if p.key == "openrouter" {
                    req = req.header("X-Title", "Tennex Office");
                }
                req
            }
        }
    }

    /// Stream text chunks from a model. Errors are readable one-line messages.
    /// Dropping the stream drops the upstream HTTP request, which cancels generation.
    pub fn stream(
        &self,
        p: Provider,
        model: String,
        system: String,
        msgs: Vec<Msg>,
    ) -> impl Stream<Item = Result<String, String>> + Send + 'static {
        let req = self.build_request(&p, &model, &system, &msgs);
        async_stream::stream! {
            let res = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    yield Err(format!("{}: could not reach {} ({})", p.label, p.base_url, short_err(&e)));
                    return;
                }
            };
            let status = res.status();
            if !status.is_success() {
                let body = res.text().await.unwrap_or_default();
                yield Err(format!("{}: HTTP {} — {}", p.label, status.as_u16(), upstream_error(&body)));
                return;
            }
            let mut bytes = res.bytes_stream();
            let mut dec = SseDecoder::new();
            let mut done = false;
            while !done {
                let events = match bytes.next().await {
                    Some(Ok(chunk)) => dec.push(&chunk),
                    Some(Err(e)) => {
                        yield Err(format!("{}: stream interrupted ({})", p.label, short_err(&e)));
                        return;
                    }
                    None => { done = true; dec.finish().into_iter().collect() }
                };
                for data in events {
                    match parse_event(p.kind, &data) {
                        Event::Text(t) => yield Ok(t),
                        Event::Error(e) => { yield Err(format!("{}: {}", p.label, e)); return; }
                        Event::Done => return,
                        Event::Skip => {}
                    }
                }
            }
        }
    }
}

fn openai_path(p: &Provider) -> &'static str {
    // Ollama's OpenAI-compatible endpoint lives under /v1; the others include /v1 in their base URL.
    if p.key == "ollama" { "/v1/chat/completions" } else { "/chat/completions" }
}

fn short_err(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "timed out".into()
    } else if e.is_connect() {
        "connection refused".into()
    } else {
        e.to_string()
    }
}

/// Pull a readable message out of an upstream error body.
pub fn upstream_error(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let msg = v["error"]["message"]
        .as_str()
        .or_else(|| v["error"].as_str())
        .or_else(|| v["message"].as_str())
        .or_else(|| v["detail"].as_str())
        .map(String::from)
        .unwrap_or_else(|| body.trim().chars().take(200).collect());
    if msg.is_empty() { "no details".into() } else { msg }
}

#[derive(Debug, PartialEq)]
pub enum Event {
    Text(String),
    Error(String),
    Done,
    Skip,
}

pub fn parse_event(kind: Kind, data: &str) -> Event {
    if data.trim() == "[DONE]" {
        return Event::Done;
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else { return Event::Skip };
    match kind {
        Kind::Anthropic => match v["type"].as_str() {
            Some("content_block_delta") if v["delta"]["type"] == "text_delta" => {
                Event::Text(v["delta"]["text"].as_str().unwrap_or_default().to_string())
            }
            Some("message_delta") if v["delta"]["stop_reason"] == "refusal" => {
                Event::Error("the model declined this request".into())
            }
            Some("error") => Event::Error(v["error"]["message"].as_str().unwrap_or("upstream error").into()),
            Some("message_stop") => Event::Done,
            _ => Event::Skip,
        },
        Kind::OpenAi => {
            if !v["error"].is_null() {
                return Event::Error(upstream_error(data));
            }
            match v["choices"][0]["delta"]["content"].as_str() {
                Some(t) if !t.is_empty() => Event::Text(t.to_string()),
                _ => Event::Skip,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn reg(vars: &[(&str, &str)]) -> Registry {
        let m: HashMap<String, String> = vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        Registry::from_vars(|k| m.get(k).cloned())
    }

    #[test]
    fn only_configured_providers_are_registered() {
        let r = reg(&[("OLLAMA_URL", "off")]);
        assert!(r.providers.is_empty());
        let r = reg(&[("NOUS_API_KEY", "k"), ("OLLAMA_URL", "off"), ("OPENAI_COMPAT_URL", "http://x/v1")]);
        // custom needs a model list to count as configured
        assert_eq!(r.providers.iter().map(|p| p.key).collect::<Vec<_>>(), vec!["nous"]);
        assert_eq!(r.provider("nous").unwrap().models, vec!["Hermes-4-70B", "Hermes-4-405B"]);
    }

    #[test]
    fn model_lists_and_urls_are_normalised() {
        let r = reg(&[
            ("ANTHROPIC_API_KEY", "k"),
            ("ANTHROPIC_MODELS", " claude-opus-5-5 , ,claude-haiku-4-5"),
            ("OPENAI_COMPAT_URL", "http://box:8000/v1/"),
            ("OPENAI_COMPAT_MODELS", "qwen"),
            ("OLLAMA_URL", "off"),
        ]);
        assert_eq!(r.provider("claude").unwrap().models, vec!["claude-opus-5-5", "claude-haiku-4-5"]);
        assert_eq!(r.provider("custom").unwrap().base_url, "http://box:8000/v1");
    }

    #[tokio::test]
    async fn resolve_rejects_unknown_models() {
        let r = reg(&[("NOUS_API_KEY", "k"), ("OLLAMA_URL", "off")]);
        assert!(r.resolve("nous:Hermes-4-70B").await.is_some());
        assert!(r.resolve("nous:gpt-9").await.is_none());
        assert!(r.resolve("claude:claude-opus-5-5").await.is_none());
        assert!(r.resolve("garbage").await.is_none());
    }

    #[tokio::test]
    async fn default_model_falls_back() {
        let r = reg(&[("NOUS_API_KEY", "k"), ("OLLAMA_URL", "off"), ("DEFAULT_MODEL", "nous:Hermes-4-405B")]);
        let models = r.models().await;
        assert_eq!(r.pick_default(&models), "nous:Hermes-4-405B");
        let r = reg(&[("NOUS_API_KEY", "k"), ("OLLAMA_URL", "off"), ("DEFAULT_MODEL", "nope:x")]);
        assert_eq!(r.pick_default(&models), "nous:Hermes-4-70B");
        assert_eq!(r.pick_default(&[]), "sim");
    }

    #[test]
    fn claude_request_shape() {
        let r = reg(&[("ANTHROPIC_API_KEY", "sk"), ("OLLAMA_URL", "off")]);
        let p = r.provider("claude").unwrap();
        let msgs = [Msg { role: "user", content: "hi".into() }];
        let req = r.build_request(p, "claude-opus-5-5", "sys", &msgs).build().unwrap();
        assert_eq!(req.url().as_str(), "https://api.anthropic.com/v1/messages");
        assert_eq!(req.headers()["x-api-key"], "sk");
        assert_eq!(req.headers()["anthropic-beta"], "server-side-fallback-2026-07-01");
        let body: Value = serde_json::from_slice(req.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["system"], "sys");
        assert_eq!(body["stream"], true);
        assert_eq!(body["output_config"]["effort"], "low");
        assert_eq!(body["fallbacks"], "default");

        let req = r.build_request(p, "claude-haiku-4-5", "sys", &msgs).build().unwrap();
        let body: Value = serde_json::from_slice(req.body().unwrap().as_bytes().unwrap()).unwrap();
        assert!(body.get("output_config").is_none());
        assert!(body.get("fallbacks").is_none());
    }

    #[test]
    fn openai_request_shape() {
        let r = reg(&[("OPENROUTER_API_KEY", "or"), ("OLLAMA_URL", "http://127.0.0.1:11434")]);
        let msgs = [Msg { role: "user", content: "hi".into() }];
        let req = r.build_request(r.provider("openrouter").unwrap(), "openrouter/auto", "sys", &msgs).build().unwrap();
        assert_eq!(req.url().as_str(), "https://openrouter.ai/api/v1/chat/completions");
        assert_eq!(req.headers()["authorization"], "Bearer or");
        let body: Value = serde_json::from_slice(req.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["messages"][0], json!({"role": "system", "content": "sys"}));
        assert_eq!(body["messages"][1]["content"], "hi");

        let req = r.build_request(r.provider("ollama").unwrap(), "llama3.2:latest", "s", &msgs).build().unwrap();
        assert_eq!(req.url().as_str(), "http://127.0.0.1:11434/v1/chat/completions");
        assert!(req.headers().get("authorization").is_none());
    }

    #[test]
    fn parses_anthropic_events() {
        let k = Kind::Anthropic;
        assert_eq!(
            parse_event(k, r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#),
            Event::Text("Hi".into())
        );
        assert_eq!(
            parse_event(k, r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"x"}}"#),
            Event::Skip
        );
        assert_eq!(
            parse_event(k, r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#),
            Event::Error("Overloaded".into())
        );
        assert!(matches!(parse_event(k, r#"{"type":"message_delta","delta":{"stop_reason":"refusal"}}"#), Event::Error(_)));
        assert_eq!(parse_event(k, r#"{"type":"message_stop"}"#), Event::Done);
    }

    #[test]
    fn parses_openai_events() {
        let k = Kind::OpenAi;
        assert_eq!(parse_event(k, r#"{"choices":[{"delta":{"content":"yo"}}]}"#), Event::Text("yo".into()));
        assert_eq!(parse_event(k, r#"{"choices":[{"delta":{"role":"assistant"}}]}"#), Event::Skip);
        assert_eq!(parse_event(k, "[DONE]"), Event::Done);
        assert_eq!(parse_event(k, r#"{"error":{"message":"rate limited"}}"#), Event::Error("rate limited".into()));
    }

    #[test]
    fn upstream_error_messages() {
        assert_eq!(upstream_error(r#"{"type":"error","error":{"type":"x","message":"invalid x-api-key"}}"#), "invalid x-api-key");
        assert_eq!(upstream_error(r#"{"detail":"Not authenticated"}"#), "Not authenticated");
        assert_eq!(upstream_error("Bad Gateway"), "Bad Gateway");
        assert_eq!(upstream_error(""), "no details");
    }
}
