#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <SPI.h>

// ====== CONFIGURE BEFORE UPLOAD ======
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* SERVER_HOST   = "your-domain.com";
const uint16_t SERVER_PORT = 443;
const char* SERVER_PATH   = "/ws/device";
const bool   USE_SSL      = true;
const char* DEVICE_TOKEN  = "PASTE_DEVICE_TOKEN_FROM_APP";
const char* FIRMWARE_VER  = "1.0.0-lcd";

#define TFT_CS   5
#define TFT_DC   4
#define TFT_RST  3
// =====================================

Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_RST);
WebSocketsClient webSocket;
unsigned long lastTelemetry = 0;

struct PinState {
  int gpio; String mode; int value; int pwmFreq; bool enabled;
};
PinState pins[16];
int pinCount = 0;
bool displayEnabled = true;
int displayBrightness = 128;
String displayLines[8];
int displayLineCount = 0;

int findPin(int gpio) {
  for (int i = 0; i < pinCount; i++) if (pins[i].gpio == gpio) return i;
  return -1;
}

void applyPin(PinState &p) {
  if (!p.enabled || p.mode == "disabled") { pinMode(p.gpio, INPUT); return; }
  if (p.mode == "output") { pinMode(p.gpio, OUTPUT); digitalWrite(p.gpio, p.value ? HIGH : LOW); }
  else if (p.mode == "input") pinMode(p.gpio, INPUT);
  else if (p.mode == "input_pullup") pinMode(p.gpio, INPUT_PULLUP);
  else if (p.mode == "pwm") { ledcAttach(p.gpio, p.pwmFreq > 0 ? p.pwmFreq : 1000, 8); ledcWrite(p.gpio, constrain(p.value, 0, 255)); }
  else if (p.mode == "adc") pinMode(p.gpio, INPUT);
}

void renderDisplay() {
  if (!displayEnabled) { tft.fillScreen(ST77XX_BLACK); return; }
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextWrap(true);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(1);
  for (int i = 0; i < displayLineCount && i < 8; i++) {
    tft.setCursor(4, 4 + i * 12);
    tft.println(displayLines[i]);
  }
}

void sendJSON(JsonDocument &doc) {
  String out; serializeJson(doc, out); webSocket.sendTXT(out);
}

void sendHello() {
  JsonDocument doc;
  doc["type"] = "hello";
  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["firmware_ver"] = FIRMWARE_VER;
  payload["local_ip"] = WiFi.localIP().toString();
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
    if (pins[i].mode != "input" && pins[i].mode != "input_pullup" && pins[i].mode != "adc") continue;
    JsonObject o = arr.add<JsonObject>();
    o["gpio"] = pins[i].gpio;
    o["value"] = (pins[i].mode == "adc") ? analogRead(pins[i].gpio) : digitalRead(pins[i].gpio);
  }
  sendJSON(doc);
}

void ack(const char* id) {
  JsonDocument doc; doc["type"] = "ack"; doc["id"] = id; sendJSON(doc);
}

void handlePinSet(JsonObject payload) {
  int gpio = payload["gpio"] | -1;
  if (gpio < 0) return;
  int idx = findPin(gpio);
  if (idx < 0) { if (pinCount >= 16) return; idx = pinCount++; pins[idx].gpio = gpio; }
  pins[idx].mode = payload["mode"] | "disabled";
  pins[idx].value = payload["value"] | 0;
  pins[idx].pwmFreq = payload["pwm_freq"] | 1000;
  pins[idx].enabled = payload["enabled"] | false;
  applyPin(pins[idx]);
}

void handleDisplaySet(JsonObject payload) {
  displayEnabled = payload["enabled"] | true;
  displayBrightness = payload["brightness"] | 128;
  bool clear = payload["clear"] | false;
  displayLineCount = 0;
  if (!clear) {
    for (JsonVariant v : payload["text_lines"].as<JsonArray>()) {
      if (displayLineCount >= 8) break;
      displayLines[displayLineCount++] = v.as<String>();
    }
  }
  renderDisplay();
}

void handleSync(JsonObject payload) {
  pinCount = 0;
  for (JsonObject p : payload["pins"].as<JsonArray>()) {
    if (pinCount >= 16) break;
    pins[pinCount].gpio = p["gpio"] | 0;
    pins[pinCount].mode = p["mode"] | "disabled";
    pins[pinCount].value = p["value"] | 0;
    pins[pinCount].pwmFreq = p["pwm_freq"] | 1000;
    pins[pinCount].enabled = p["enabled"] | false;
    applyPin(pins[pinCount]);
    pinCount++;
  }
  if (!payload["display"].isNull()) handleDisplaySet(payload["display"].as<JsonObject>());
}

void onMessage(uint8_t* payload, size_t length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  const char* type = doc["type"] | "";
  const char* id = doc["id"] | "";
  JsonObject p = doc["payload"].as<JsonObject>();
  if (strcmp(type, "pin_set") == 0) { handlePinSet(p); if (strlen(id)) ack(id); }
  else if (strcmp(type, "display_set") == 0) { handleDisplaySet(p); if (strlen(id)) ack(id); }
  else if (strcmp(type, "sync") == 0) { handleSync(p); if (strlen(id)) ack(id); sendHello(); }
  else if (strcmp(type, "ping") == 0) { JsonDocument resp; resp["type"] = "pong"; sendJSON(resp); }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) { Serial.println("WS connected"); sendHello(); }
  else if (type == WStype_TEXT) onMessage(payload, length);
}

void setup() {
  Serial.begin(115200);
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(1);
  tft.fillScreen(ST77XX_BLACK);
  displayLines[0] = "ESP32-C3 LCD";
  displayLines[1] = "Connecting...";
  displayLineCount = 2;
  renderDisplay();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(400);
  displayLines[1] = WiFi.localIP().toString();
  renderDisplay();

  String path = String(SERVER_PATH) + "?token=" + DEVICE_TOKEN;
  if (USE_SSL) webSocket.beginSSL(SERVER_HOST, SERVER_PORT, path.c_str());
  else webSocket.begin(SERVER_HOST, SERVER_PORT, path.c_str());
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
