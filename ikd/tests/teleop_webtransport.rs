use std::{net::SocketAddr, time::Duration};

use ikd::teleop::{
    decode_control_packet, encode_control_ack, TeleopControlAck, TeleopControlPacket, TeleopHub,
    TeleopPeerRole, TeleopTransport,
};
use wtransport::{endpoint::IncomingSession, ClientConfig, Endpoint, Identity, ServerConfig};

const TEST_BIND_ADDR: &str = "127.0.0.1:0";
const TEST_WEBTRANSPORT_PATH: &str = "/teleop";
const TEST_SESSION_ID: &str = "teleop-session-a";
const TEST_PEER_ID: &str = "operator-a";
const TEST_COMMAND_KIND: &str = "twist";
const TEST_SEQUENCE: u64 = 1;
const TEST_TIMESTAMP_NS: u64 = 123_456_789;
const TEST_TIMEOUT_MS: u64 = 2_000;
const TEST_ACK_DRAIN_SLEEP_DIVISOR: u64 = 10;

#[tokio::test]
async fn teleop_webtransport_datagram_round_trip_acks_control_packets() {
    let hub = TeleopHub::new();
    let identity = Identity::self_signed(["localhost", "127.0.0.1", "::1"])
        .expect("self signed test identity");
    let server_config = ServerConfig::builder()
        .with_bind_address(
            TEST_BIND_ADDR
                .parse::<SocketAddr>()
                .expect("test bind addr"),
        )
        .with_identity(identity)
        .build();
    let server = Endpoint::server(server_config).expect("webtransport server endpoint");
    let server_addr = server.local_addr().expect("webtransport server addr");
    let server_task =
        tokio::spawn(
            async move { serve_one_webtransport_datagram(server.accept().await, hub).await },
        );

    let client_config = ClientConfig::builder()
        .with_bind_default()
        .with_no_cert_validation()
        .build();
    let client = Endpoint::client(client_config).expect("webtransport client endpoint");
    let connection = client
        .connect(format!(
            "https://127.0.0.1:{}{}",
            server_addr.port(),
            TEST_WEBTRANSPORT_PATH
        ))
        .await
        .expect("webtransport client connection");

    let packet = TeleopControlPacket {
        session_id: TEST_SESSION_ID.to_string(),
        peer_id: TEST_PEER_ID.to_string(),
        role: TeleopPeerRole::Operator,
        sequence: TEST_SEQUENCE,
        monotonic_timestamp_ns: TEST_TIMESTAMP_NS,
        command_kind: TEST_COMMAND_KIND.to_string(),
        ack_requested: true,
        payload: serde_json::json!({ "x": 0.2 }),
    };
    connection
        .send_datagram(serde_json::to_vec(&packet).expect("encoded teleop packet"))
        .expect("send webtransport datagram");

    let ack_datagram = tokio::time::timeout(
        Duration::from_millis(TEST_TIMEOUT_MS),
        connection.receive_datagram(),
    )
    .await
    .expect("webtransport ack timeout")
    .expect("webtransport ack datagram");
    let ack: TeleopControlAck =
        serde_json::from_slice(ack_datagram.as_ref()).expect("decoded teleop ack");

    assert!(ack.accepted);
    assert_eq!(ack.session_id, TEST_SESSION_ID);
    assert_eq!(ack.peer_id, TEST_PEER_ID);
    assert_eq!(ack.sequence, TEST_SEQUENCE);

    server_task.await.expect("webtransport server task");
}

async fn serve_one_webtransport_datagram(incoming_session: IncomingSession, hub: TeleopHub) {
    let request = incoming_session
        .await
        .expect("incoming webtransport request");
    assert_eq!(request.path(), TEST_WEBTRANSPORT_PATH);
    let connection = request
        .accept()
        .await
        .expect("accepted webtransport request");
    let datagram = connection
        .receive_datagram()
        .await
        .expect("server datagram");
    let packet = decode_control_packet(datagram.as_ref()).expect("decoded server packet");
    let ack = hub
        .record_packet(TeleopTransport::WebTransport, packet, datagram.len())
        .await;
    connection
        .send_datagram(encode_control_ack(&ack).expect("encoded ack"))
        .expect("server ack send");
    tokio::time::sleep(Duration::from_millis(
        TEST_TIMEOUT_MS / TEST_ACK_DRAIN_SLEEP_DIVISOR,
    ))
    .await;
}
