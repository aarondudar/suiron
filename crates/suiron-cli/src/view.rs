//! Static serving shared by `lab` and `view`: the built frontend from
//! web/dist, plus (for `view`) a recorded trace file at the API path.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

const DIST: &str = "web/dist";

/// `suiron view <trace.json>`: serve a recorded trace + the built frontend.
pub fn serve(trace_path: &str, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let trace = std::fs::read(trace_path)?;
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    println!("suiron view · http://127.0.0.1:{port}  (ctrl-c to stop)");
    if !Path::new(DIST).exists() {
        eprintln!("note: {DIST} not found — run `npm run build` in web/ first");
    }

    for stream in listener.incoming() {
        let Ok(mut s) = stream else { continue };
        let mut buf = [0u8; 8192];
        let n = s.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);
        let path = req.split_whitespace().nth(1).unwrap_or("/");

        match path.split('?').next().unwrap_or("") {
            "/api/v1/trace" => respond(&mut s, "200 OK", "application/json", &trace),
            p => serve_static(&mut s, p),
        }
    }
    Ok(())
}

/// Serve a file from web/dist; unknown paths fall back to index.html so the
/// SPA owns routing. Rejects path traversal. API paths never fall through to
/// the SPA — an unknown /api route means a stale backend, and an honest 404
/// beats serving HTML to a JSON client.
pub fn serve_static(s: &mut TcpStream, path: &str) {
    if path.contains("..") {
        respond(s, "403 Forbidden", "text/plain", b"no");
        return;
    }
    if path.starts_with("/api/") {
        respond(
            s,
            "404 Not Found",
            "text/plain",
            b"unknown api route - restart the lab (binary may predate this endpoint)",
        );
        return;
    }
    let rel = path.trim_start_matches('/');
    let mut file = PathBuf::from(DIST);
    file.push(if rel.is_empty() { "index.html" } else { rel });

    let body = std::fs::read(&file).or_else(|_| std::fs::read(format!("{DIST}/index.html")));
    match body {
        Ok(body) => respond(s, "200 OK", mime(&file), &body),
        Err(_) => respond(
            s,
            "200 OK",
            "text/plain",
            b"suiron lab is running, but web/dist is missing.\n\
              build the frontend:  cd web && npm install && npm run build\n\
              or develop live:     cd web && npm run dev   (proxies to this server)\n",
        ),
    }
}

fn mime(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

pub fn respond(s: &mut TcpStream, status: &str, ctype: &str, body: &[u8]) {
    let _ = write!(
        s,
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = s.write_all(body);
}
