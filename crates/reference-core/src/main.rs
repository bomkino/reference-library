use std::io;

fn main() {
    if let Err(error) = reference_core::server::run_server(io::stdin(), io::stdout()) {
        eprintln!("reference-core: {error}");
        std::process::exit(1);
    }
}
