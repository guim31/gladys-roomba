// -----------------------------------------------------------------------------
// The TLS profile a Roomba accepts.
//
// The robot presents a self-signed certificate (nothing to verify it against)
// and its older firmware only offers TLS 1.2 with RSA key exchange
// (AES128-SHA256) and does not support secure renegotiation. OpenSSL 3, the
// TLS library of Node 22 and 24, refuses such a server by default ("unsafe
// legacy renegotiation disabled"), and its security level may refuse a small
// key or an old signature. The profile below is the one roombapy (Home
// Assistant) and dorita980 converged on, in Node terms:
//   - no certificate check (self-signed, like the official app);
//   - SSL_OP_LEGACY_SERVER_CONNECT, the legacy renegotiation of old firmware;
//   - OpenSSL's DEFAULT ciphers without DH (roombapy: the robots send small
//     DH parameters that OpenSSL 3 rejects), plus AES128-SHA256 (dorita980's
//     cipher), at security level 0 so neither key size nor signature
//     algorithm can fail the handshake.
// Measured in the development session (no robot): Node 22 / OpenSSL 3.0
// connects with this profile to a TLS 1.2-only server offering AES128-SHA256
// with a 1024-bit SHA-1 certificate.
// -----------------------------------------------------------------------------

import tls from 'node:tls';
import { constants } from 'node:crypto';

export const ROBOT_PORT = 8883;

export const ROBOT_TLS_OPTIONS = Object.freeze({
  rejectUnauthorized: false,
  ciphers: 'DEFAULT:!DH:AES128-SHA256:@SECLEVEL=0',
  secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
});

/**
 * Open a TLS socket to a robot; resolves once the handshake is done.
 * @param {{ host: string, port?: number, timeoutMs?: number }} options
 * @returns {Promise<import('node:tls').TLSSocket>}
 */
export function connectTls({ host, port = ROBOT_PORT, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, ...ROBOT_TLS_OPTIONS });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error('TLS connection timed out'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
