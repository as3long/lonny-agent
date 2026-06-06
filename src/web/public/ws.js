/* ── WebSocket Reference & Send ── */

let ws = null

export function getWs() {
  return ws
}

export function setWs(newWs) {
  ws = newWs
}

export function sendWsMsg(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
    return true
  }
  return false
}
