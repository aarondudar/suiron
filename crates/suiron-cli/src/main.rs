use std::collections::BTreeMap;
use std::process::ExitCode;
use std::time::Instant;

use suiron_gguf::GgufFile;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("inspect") => match args.get(2) {
            Some(path) => inspect(path),
            None => usage(),
        },
        _ => usage(),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn usage() -> Result<(), Box<dyn std::error::Error>> {
    Err("usage: suiron inspect <model.gguf>".into())
}

fn inspect(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let start = Instant::now();
    let file = GgufFile::open(path)?;
    let elapsed = start.elapsed();

    let file_bytes = std::fs::metadata(path)?.len();
    println!("{path}");
    println!(
        "GGUF v{} · {} · {} tensors · {} metadata keys · parsed in {elapsed:.2?}",
        file.version,
        human_bytes(file_bytes),
        file.tensors.len(),
        file.metadata.len(),
    );

    println!("\nmetadata:");
    for (key, value) in &file.metadata {
        println!("  {key} = {value}");
    }

    println!("\ntensors:");
    for t in &file.tensors {
        let dims: Vec<String> = t.dims.iter().map(u64::to_string).collect();
        println!(
            "  {:<44} {:>8} {:>14}  [{}]",
            t.name,
            t.dtype.to_string(),
            group_digits(t.n_elements()),
            dims.join(" × "),
        );
    }

    let total_params: u64 = file.tensors.iter().map(|t| t.n_elements()).sum();
    let mut by_dtype: BTreeMap<String, u64> = BTreeMap::new();
    for t in &file.tensors {
        *by_dtype.entry(t.dtype.to_string()).or_default() += t.size_bytes().unwrap_or(0);
    }
    let breakdown: Vec<String> = by_dtype
        .iter()
        .map(|(dtype, bytes)| format!("{dtype} {}", human_bytes(*bytes)))
        .collect();
    println!("\ntotal: {} parameters ({})", group_digits(total_params), breakdown.join(", "));
    Ok(())
}

fn group_digits(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}
