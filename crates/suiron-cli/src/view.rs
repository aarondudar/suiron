//! Minimal HTTP server for the microscope viewer: serves the embedded
//! single-file UI at `/` and the trace JSON at `/trace`. std only.

use std::io::{Read, Write};
use std::net::TcpListener;

const VIEWER: &str = include_str!("viewer.html");

pub fn serve(trace_path: &str, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let trace = std::fs::read(trace_path)?;
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    println!("suiron view · http://127.0.0.1:{port}  (ctrl-c to stop)");

    for stream in listener.incoming() {
        let mut s = match stream {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut buf = [0u8; 8192];
        let n = s.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);
        let path = req.split_whitespace().nth(1).unwrap_or("/");

        let (status, ctype, body): (&str, &str, &[u8]) = match path {
            "/" => ("200 OK", "text/html; charset=utf-8", VIEWER.as_bytes()),
            "/trace" => ("200 OK", "application/json", &trace),
            _ => ("404 Not Found", "text/plain", b"not found"),
        };
        let _ = write!(
            s,
            "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = s.write_all(body);
    }
    Ok(())
}
