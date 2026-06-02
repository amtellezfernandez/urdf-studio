use std::{fs::File, io::BufReader, path::Path, sync::Arc};

use axum::{extract::State, routing::get, Json, Router};
use bytes::Bytes;
use ikd::teleop::{
    decode_control_packet, encode_control_ack,
    params::{
        keep_alive_interval, TELEOP_MAX_DATAGRAM_BYTES, TELEOP_NATIVE_QUIC_ALPN,
        TELEOP_WEBTRANSPORT_SELF_SIGNED_SAN_IPV4_LOOPBACK,
        TELEOP_WEBTRANSPORT_SELF_SIGNED_SAN_IPV6_LOOPBACK,
        TELEOP_WEBTRANSPORT_SELF_SIGNED_SAN_LOCALHOST,
    },
    CertificateMode, NativeQuicSecurityMode, TeleopControlAck, TeleopHub, TeleopManifest,
    TeleopSidecarConfig, TeleopStatsSnapshot, TeleopTransport,
};
use quinn::{
    crypto::rustls::QuicServerConfig as QuinnRustlsServerConfig, Endpoint as QuicEndpoint,
    ServerConfig as QuicServerConfig,
};
use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer},
    server::WebPkiClientVerifier,
    RootCertStore, ServerConfig as RustlsServerConfig,
};
use serde::Serialize;
use tokio::net::TcpListener;
use tracing::{error, info, warn};
use wtransport::{
    Endpoint as WebTransportEndpoint, Identity, ServerConfig as WebTransportServerConfig,
};

type SidecarResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone)]
struct HttpState {
    config: Arc<TeleopSidecarConfig>,
    hub: TeleopHub,
}

#[derive(Debug, Serialize)]
struct TeleopHealthResponse {
    status: &'static str,
    manifest: TeleopManifest,
    stats: TeleopStatsSnapshot,
}

#[tokio::main]
async fn main() {
    init_tracing();

    let config = match TeleopSidecarConfig::from_env() {
        Ok(config) => Arc::new(config),
        Err(error) => {
            error!("invalid teleop sidecar config: {error}");
            std::process::exit(1);
        }
    };
    let hub = TeleopHub::new();

    let http_state = HttpState {
        config: Arc::clone(&config),
        hub: hub.clone(),
    };
    let http_task = tokio::spawn(run_http(http_state));

    let webtransport_task = if config.enable_webtransport {
        let webtransport_config = Arc::clone(&config);
        let webtransport_hub = hub.clone();
        Some(tokio::spawn(async move {
            run_webtransport(webtransport_config, webtransport_hub).await
        }))
    } else {
        None
    };

    let native_quic_task = if config.enable_native_quic {
        match config.native_quic_security_mode() {
            NativeQuicSecurityMode::MutualTls | NativeQuicSecurityMode::NoClientAuthDevelopment => {
                let native_config = Arc::clone(&config);
                let native_hub = hub.clone();
                Some(tokio::spawn(async move {
                    run_native_quic(native_config, native_hub).await
                }))
            }
            NativeQuicSecurityMode::DisabledMissingClientCa => {
                warn!("native QUIC requested but TELEOP_SIDECAR_NATIVE_CLIENT_CA_PEM is missing");
                None
            }
        }
    } else {
        None
    };

    info!(
        "teleop sidecar listening http={} webtransport={} native_quic={}",
        config.http_bind, config.webtransport_bind, config.native_quic_bind
    );

    tokio::select! {
        result = http_task => log_task_result("http", result),
        result = async {
            match webtransport_task {
                Some(task) => task.await,
                None => std::future::pending().await,
            }
        } => log_task_result("webtransport", result),
        result = async {
            match native_quic_task {
                Some(task) => task.await,
                None => std::future::pending().await,
            }
        } => log_task_result("native_quic", result),
        result = tokio::signal::ctrl_c() => {
            if let Err(error) = result {
                warn!("teleop sidecar signal listener failed: {error}");
            }
        },
    }
}

fn init_tracing() {
    use tracing_subscriber::EnvFilter;

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,teleop_sidecar=debug,ikd=debug"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}

fn log_task_result(task_name: &str, result: Result<SidecarResult<()>, tokio::task::JoinError>) {
    match result {
        Ok(Ok(())) => info!("teleop sidecar {task_name} task stopped"),
        Ok(Err(error)) => error!("teleop sidecar {task_name} task failed: {error}"),
        Err(error) => error!("teleop sidecar {task_name} task panicked: {error}"),
    }
}

async fn run_http(state: HttpState) -> SidecarResult<()> {
    let app = Router::new()
        .route("/health", get(health))
        .route("/teleop/manifest", get(manifest))
        .route("/teleop/stats", get(stats))
        .with_state(state.clone());
    let listener = TcpListener::bind(state.config.http_bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health(State(state): State<HttpState>) -> Json<TeleopHealthResponse> {
    Json(TeleopHealthResponse {
        status: "ok",
        manifest: TeleopManifest::from_config(&state.config),
        stats: state.hub.stats().await,
    })
}

async fn manifest(State(state): State<HttpState>) -> Json<TeleopManifest> {
    Json(TeleopManifest::from_config(&state.config))
}

async fn stats(State(state): State<HttpState>) -> Json<TeleopStatsSnapshot> {
    Json(state.hub.stats().await)
}

async fn run_webtransport(config: Arc<TeleopSidecarConfig>, hub: TeleopHub) -> SidecarResult<()> {
    let identity = load_webtransport_identity(&config).await?;
    let server_config = WebTransportServerConfig::builder()
        .with_bind_address(config.webtransport_bind)
        .with_identity(identity)
        .keep_alive_interval(Some(keep_alive_interval()))
        .build();
    let server = WebTransportEndpoint::server(server_config)?;
    info!(
        "teleop WebTransport/HTTP3 listening on {}{}",
        config.webtransport_bind, config.webtransport_path
    );

    loop {
        let incoming_session = server.accept().await;
        let session_config = Arc::clone(&config);
        let session_hub = hub.clone();
        tokio::spawn(async move {
            if let Err(error) =
                handle_webtransport_session(incoming_session, session_config, session_hub).await
            {
                warn!("teleop WebTransport session failed: {error}");
            }
        });
    }
}

async fn load_webtransport_identity(config: &TeleopSidecarConfig) -> SidecarResult<Identity> {
    match (&config.cert_pem, &config.key_pem) {
        (Some(cert_pem), Some(key_pem)) => Ok(Identity::load_pemfiles(cert_pem, key_pem).await?),
        _ => {
            if config.certificate_mode() == CertificateMode::SelfSignedDevelopment {
                warn!(
                    "teleop WebTransport using self-signed development certificate; browsers must trust it explicitly"
                );
            }
            Ok(Identity::self_signed([
                TELEOP_WEBTRANSPORT_SELF_SIGNED_SAN_LOCALHOST,
                TELEOP_WEBTRANSPORT_SELF_SIGNED_SAN_IPV4_LOOPBACK,
                TELEOP_WEBTRANSPORT_SELF_SIGNED_SAN_IPV6_LOOPBACK,
            ])?)
        }
    }
}

async fn handle_webtransport_session(
    incoming_session: wtransport::endpoint::IncomingSession,
    config: Arc<TeleopSidecarConfig>,
    hub: TeleopHub,
) -> SidecarResult<()> {
    let request = incoming_session.await?;
    if request.path() != config.webtransport_path {
        request.not_found().await;
        return Ok(());
    }
    let connection = request.accept().await?;

    loop {
        let datagram = connection.receive_datagram().await?;
        let ack = handle_datagram(&hub, TeleopTransport::WebTransport, datagram.as_ref()).await;
        connection.send_datagram(encode_control_ack(&ack)?)?;
    }
}

async fn run_native_quic(config: Arc<TeleopSidecarConfig>, hub: TeleopHub) -> SidecarResult<()> {
    let endpoint = build_native_quic_endpoint(&config)?;
    info!(
        "teleop native QUIC listening on {} alpn={}",
        config.native_quic_bind,
        String::from_utf8_lossy(TELEOP_NATIVE_QUIC_ALPN)
    );

    while let Some(incoming) = endpoint.accept().await {
        let native_hub = hub.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_native_quic_connection(incoming, native_hub).await {
                warn!("teleop native QUIC connection failed: {error}");
            }
        });
    }
    Ok(())
}

fn build_native_quic_endpoint(config: &TeleopSidecarConfig) -> SidecarResult<QuicEndpoint> {
    let Some(cert_pem) = config.cert_pem.as_deref() else {
        return Err("native QUIC requires TELEOP_SIDECAR_CERT_PEM".into());
    };
    let Some(key_pem) = config.key_pem.as_deref() else {
        return Err("native QUIC requires TELEOP_SIDECAR_KEY_PEM".into());
    };
    let certs = load_certificates(cert_pem)?;
    let key = load_private_key(key_pem)?;

    let mut server_crypto = if let Some(client_ca_pem) = config.native_client_ca_pem.as_deref() {
        let roots = load_root_store(client_ca_pem)?;
        let verifier = WebPkiClientVerifier::builder(Arc::new(roots)).build()?;
        RustlsServerConfig::builder()
            .with_client_cert_verifier(verifier)
            .with_single_cert(certs, key)?
    } else if config.allow_insecure_native_quic {
        warn!("teleop native QUIC running without client certificates for development");
        RustlsServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(certs, key)?
    } else {
        return Err("native QUIC requires TELEOP_SIDECAR_NATIVE_CLIENT_CA_PEM or explicit development override".into());
    };

    server_crypto.alpn_protocols = vec![TELEOP_NATIVE_QUIC_ALPN.to_vec()];
    let server_config =
        QuicServerConfig::with_crypto(Arc::new(QuinnRustlsServerConfig::try_from(server_crypto)?));
    Ok(QuicEndpoint::server(
        server_config,
        config.native_quic_bind,
    )?)
}

async fn handle_native_quic_connection(
    incoming: quinn::Incoming,
    hub: TeleopHub,
) -> SidecarResult<()> {
    let connection = incoming.await?;
    loop {
        let datagram = match connection.read_datagram().await {
            Ok(datagram) => datagram,
            Err(quinn::ConnectionError::ApplicationClosed { .. }) => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        let ack = handle_datagram(&hub, TeleopTransport::NativeQuic, datagram.as_ref()).await;
        connection.send_datagram(Bytes::from(encode_control_ack(&ack)?))?;
    }
}

async fn handle_datagram(
    hub: &TeleopHub,
    transport: TeleopTransport,
    datagram: &[u8],
) -> TeleopControlAck {
    if datagram.len() > TELEOP_MAX_DATAGRAM_BYTES {
        return hub
            .record_rejected_control(transport, ikd::teleop::TeleopAckReason::PayloadTooLarge)
            .await;
    }
    match decode_control_packet(datagram) {
        Ok(packet) => hub.record_packet(transport, packet, datagram.len()).await,
        Err(_) => {
            hub.record_rejected_control(transport, ikd::teleop::TeleopAckReason::MalformedPacket)
                .await
        }
    }
}

fn load_root_store(path: &Path) -> SidecarResult<RootCertStore> {
    let certs = load_certificates(path)?;
    let mut store = RootCertStore::empty();
    for cert in certs {
        store.add(cert)?;
    }
    Ok(store)
}

fn load_certificates(path: &Path) -> SidecarResult<Vec<CertificateDer<'static>>> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let certs = rustls_pemfile::certs(&mut reader).collect::<Result<Vec<_>, _>>()?;
    Ok(certs)
}

fn load_private_key(path: &Path) -> SidecarResult<PrivateKeyDer<'static>> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    rustls_pemfile::private_key(&mut reader)?
        .ok_or_else(|| format!("no private key found in {}", path.display()).into())
}
