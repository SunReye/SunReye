//! Loopback ports for tests.

/// A port every dial is refused on: bound, so no other test can take it, and never listening.
/// Keep the socket alive for as long as the port must stay closed.
pub fn closed_port() -> (tokio::net::TcpSocket, u16) {
    let socket = tokio::net::TcpSocket::new_v4().expect("socket");
    socket.bind("127.0.0.1:0".parse().expect("addr")).expect("bind");
    let port = socket.local_addr().expect("addr").port();
    (socket, port)
}
