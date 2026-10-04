//! Minimal incremental Server-Sent Events decoder for upstream model streams.

#[derive(Default)]
pub struct SseDecoder {
    buf: Vec<u8>,
    data: Vec<String>,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed raw bytes; returns the `data` payload of every event completed by this chunk.
    /// Bytes are buffered until a full line arrives, so multi-byte UTF-8 split across chunks is safe.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = self.buf.drain(..=pos).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8_lossy(&line);
            if line.is_empty() {
                if !self.data.is_empty() {
                    events.push(self.data.join("\n"));
                    self.data.clear();
                }
            } else if let Some(rest) = line.strip_prefix("data:") {
                self.data.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
            }
            // `event:`, `id:`, `retry:` and `:comments` are not needed: payloads carry their own type.
        }
        events
    }

    /// Flush a trailing event that wasn't terminated by a blank line.
    pub fn finish(&mut self) -> Option<String> {
        let rest = std::mem::take(&mut self.buf);
        let line = String::from_utf8_lossy(&rest);
        if let Some(d) = line.trim_end().strip_prefix("data:") {
            self.data.push(d.strip_prefix(' ').unwrap_or(d).to_string());
        }
        if self.data.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.data).join("\n"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_events_across_chunks() {
        let mut d = SseDecoder::new();
        assert!(d.push(b"event: x\ndata: {\"a\"").is_empty());
        assert!(d.push(b":1}\n").is_empty());
        assert_eq!(d.push(b"\ndata: two\r\n\r\n"), vec!["{\"a\":1}", "two"]);
    }

    #[test]
    fn utf8_split_mid_character() {
        let mut d = SseDecoder::new();
        let bytes = "data: héllo\n\n".as_bytes();
        let (a, b) = bytes.split_at(8); // splits inside 'é'
        assert!(d.push(a).is_empty());
        assert_eq!(d.push(b), vec!["héllo"]);
    }

    #[test]
    fn finish_flushes_unterminated() {
        let mut d = SseDecoder::new();
        assert!(d.push(b"data: [DONE]").is_empty());
        assert_eq!(d.finish().as_deref(), Some("[DONE]"));
    }
}
