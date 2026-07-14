#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ====== CONFIGURE BEFORE UPLOAD ======
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* SERVER_HOST   = "your-domain.com";   // no https://
const uint16_t SERVER_PORT = 443;                // 80 for local http, 443 for wss
const char* SERVER_PATH   = "/ws/device";
const bool   USE_SSL      = true;                // false for local network ws://
const char* DEVICE_TOKEN  = "PASTE_DEVICE_TOKEN_FROM_APP";
const char* FIRMWARE_VER  = "1.0.0-basic";
// =====================================

WebSocketsClient webSocket;
unsigned long lastTelemetry = 0;

struct PinState {
  int gpio;
  String mode;
  int value;
  int pwmFreq;
  bool enabled;
};

PinState pins[22];
int pinCount = 0;

int findPin(int gpio) {
  for (int i = 0; i < pinCount; i++) {
    if (pins[i].gpio == gpio) return i;
  }
  return -1;
}

void applyPin(PinState &p) {
  if (!p.enabled || p.mode == "disabled") {
    pinMode(p.gpio, INPUT);
    return;
  }
  if (p.mode == "output") {
    pinMode(p.gpio, OUTPUT);
    digitalWrite(p.gpio, p.value ? HIGH : LOW);
  } else if (p.mode == "input") {
    pinMode(p.gpio, INPUT);
  } else if (p.mode == "input_pullup") {
    pinMode(p.gpio, INPUT_PULLUP);
  } else if (p.mode == "pwm") {
    ledcAttach(p.gpio, p.pwmFreq > 0 ? p.pwmFreq : 1000, 8);
    ledcWrite(p.gpio, constrain(p.value, 0, 255));
  } else if (p.mode == "adc") {
    pinMode(p.gpio, INPUT);
  }
}

void sendJSON(JsonDocument &doc) {
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

void sendHello() {
  JsonDocument doc;
  doc["type"] = "hello";
  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["firmware_ver"] = FIRMWARE_VER;
  payload["local_ip"] = WiFi.localIP().toString();
  JsonArray arr = payload["pins"].to<JsonArray>();
  for (int i = 0; i < pinCount; i++) {
    if (!pins[i].enabled) continue;
    JsonObject o = arr.add<JsonObject>();
    o["gpio"] = pins[i].gpio;
    if (pins[i].mode == "adc") o["value"] = analogRead(pins[i].gpio);
    else if (pins[i].mode == "input" || pins[i].mode == "input_pullup")
      o["value"] = digitalRead(pins[i].gpio);
    else o["value"] = pins[i].value;
  }
  sendJSON(doc);
}

void sendTelemetry() {
  JsonDocument doc;
  doc["type"] = "telemetry";
  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["firmware_ver"] = FIRMWARE_VER;
  payload["local_ip"] = WiFi.localIP().toString();
  JsonArray arr = payload["pins"].to<JsonArray>();
  for (int i = 0; i < pinCount; i++) {
    if (!pins[i].enabled) continue;
    if (pins[i].mode != "input" && pins[i].mode != "input_pullup" && pins[i].mode != "adc")
      continue;
    JsonObject o = arr.add<JsonObject>();
    o["gpio"] = pins[i].gpio;
    o["value"] = (pins[i].mode == "adc") ? analogRead(pins[i].gpio) : digitalRead(pins[i].gpio);
  }
  sendJSON(doc);
}

void ack(const char* id) {
  JsonDocument doc;
  doc["type"] = "ack";
  doc["id"] = id;
  sendJSON(doc);
}

void handlePinSet(JsonObject payload) {
  int gpio = payload["gpio"] | -1;
  if (gpio < 0) return;
  int idx = findPin(gpio);
  if (idx < 0) {
    if (pinCount >= 22) return;
    idx = pinCount++;
    pins[idx].gpio = gpio;
  }
  pins[idx].mode = payload["mode"] | "disabled";
  pins[idx].value = payload["value"] | 0;
  pins[idx].pwmFreq = payload["pwm_freq"] | 1000;
  pins[idx].enabled = payload["enabled"] | false;
  applyPin(pins[idx]);
}

void handleSync(JsonObject payload) {
  pinCount = 0;
  JsonArray arr = payload["pins"].as<JsonArray>();
  for (JsonObject p : arr) {
    if (pinCount >= 22) break;
    pins[pinCount].gpio = p["gpio"] | 0;
    pins[pinCount].mode = p["mode"] | "disabled";
    pins[pinCount].value = p["value"] | 0;
    pins[pinCount].pwmFreq = p["pwm_freq"] | 1000;
    pins[pinCount].enabled = p["enabled"] | false;
    applyPin(pins[pinCount]);
    pinCount++;
  }
}

void onMessage(uint8_t* payload, size_t length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  const char* type = doc["type"] | "";
  const char* id = doc["id"] | "";
  JsonObject p = doc["payload"].as<JsonObject>();

  if (strcmp(type, "pin_set") == 0) {
    handlePinSet(p);
    if (strlen(id)) ack(id);
  } else if (strcmp(type, "sync") == 0) {
    handleSync(p);
    if (strlen(id)) ack(id);
    sendHello();
  } else if (strcmp(type, "ping") == 0) {
    JsonDocument resp;
    resp["type"] = "pong";
    sendJSON(resp);
  }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("WS connected");
      sendHello();
      break;
    case WStype_TEXT:
      onMessage(payload, length);
      break;
    case WStype_DISCONNECTED:
      Serial.println("WS disconnected");
      break;
    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.println(WiFi.localIP());

  String path = String(SERVER_PATH) + "?token=" + DEVICE_TOKEN;
  if (USE_SSL) {
    webSocket.beginSSL(SERVER_HOST, SERVER_PORT, path.c_str());
  } else {
    webSocket.begin(SERVER_HOST, SERVER_PORT, path.c_str());
  }
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);
}

void loop() {
  webSocket.loop();
  if (millis() - lastTelemetry > 2000) {
    lastTelemetry = millis();
    if (webSocket.isConnected()) sendTelemetry();
  }
}
