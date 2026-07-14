#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <U8g2lib.h>

// ====== CONFIGURE BEFORE UPLOAD ======
const char* WIFI_SSID     = "Pakkada";
const char* WIFI_PASS     = "Pakkada@2025#";
const char* SERVER_HOST   = "iot.ntoric.com";
const uint16_t SERVER_PORT = 443;
const char* SERVER_PATH   = "/ws/device";
const bool   USE_SSL      = true;
const char* DEVICE_TOKEN  = "5f6b7619-b92c-4813-85e2-77eeaadefda1";
const char* FIRMWARE_VER  = "1.1.0-oled";

// Defaults — can be overridden live from the app (bus_set)
int OLED_SDA = 5;
int OLED_SCL = 6;
int BUS_RX   = 20;
int BUS_TX   = 21;
int UART_BAUD = 115200;
// Built-in LED on many ESP32-C3 boards (active-LOW)
const int BUILTIN_LED_GPIO = 8;
// =====================================

U8G2_SSD1306_72X40_ER_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE, OLED_SCL, OLED_SDA);
WebSocketsClient webSocket;
unsigned long lastTelemetry = 0;
String serialLineBuf;

struct PinState {
  int gpio;
  String mode;
  int value;
  int pwmFreq;
  bool enabled;
};
PinState pins[16];
int pinCount = 0;

bool displayEnabled = true;
int displayBrightness = 128;
String displayLines[6];
int displayLineCount = 0;
bool displayReady = false;

int findPin(int gpio) {
  for (int i = 0; i < pinCount; i++) if (pins[i].gpio == gpio) return i;
  return -1;
}

// GPIO8 built-in LED is active-LOW: app HIGH (1) => LED on
bool outputLevel(int gpio, int value) {
  bool on = value != 0;
  if (gpio == BUILTIN_LED_GPIO) on = !on;
  return on;
}

void applyPin(PinState &p) {
  if (!p.enabled || p.mode == "disabled") { pinMode(p.gpio, INPUT); return; }
  if (p.mode == "output") {
    pinMode(p.gpio, OUTPUT);
    digitalWrite(p.gpio, outputLevel(p.gpio, p.value) ? HIGH : LOW);
  } else if (p.mode == "input") pinMode(p.gpio, INPUT);
  else if (p.mode == "input_pullup") pinMode(p.gpio, INPUT_PULLUP);
  else if (p.mode == "pwm") {
    ledcAttach(p.gpio, p.pwmFreq > 0 ? p.pwmFreq : 1000, 8);
    int duty = constrain(p.value, 0, 255);
    if (p.gpio == BUILTIN_LED_GPIO) duty = 255 - duty;
    ledcWrite(p.gpio, duty);
  } else if (p.mode == "adc") pinMode(p.gpio, INPUT);
}

void renderDisplay() {
  if (!displayReady) return;
  display.clearBuffer();
  if (!displayEnabled) {
    display.sendBuffer();
    return;
  }
  display.setContrast(constrain(displayBrightness, 0, 255));
  display.setFont(u8g2_font_6x10_tf);
  for (int i = 0; i < displayLineCount && i < 4; i++) {
    display.drawStr(0, 10 + (i * 10), displayLines[i].c_str());
  }
  display.sendBuffer();
}

void initDisplayBus() {
  Wire.end();
  Wire.begin(OLED_SDA, OLED_SCL);
  display.setI2CAddress(0x3C * 2);
  display.begin();
  displayReady = true;
  renderDisplay();
}

void applyUartBus() {
  // USB Serial stays on default; secondary UART uses configured RX/TX
  Serial1.end();
  Serial1.begin(UART_BAUD, SERIAL_8N1, BUS_RX, BUS_TX);
  Serial.printf("UART1 RX=%d TX=%d baud=%d\n", BUS_RX, BUS_TX, UART_BAUD);
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
  JsonObject bus = payload["bus"].to<JsonObject>();
  bus["sda"] = OLED_SDA;
  bus["scl"] = OLED_SCL;
  bus["rx"] = BUS_RX;
  bus["tx"] = BUS_TX;
  bus["uart_baud"] = UART_BAUD;
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

void sendDeviceData(const char* source, const String &message) {
  JsonDocument doc;
  doc["type"] = "data";
  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["source"] = source;
  payload["message"] = message;
  payload["ts"] = (long)millis();
  sendJSON(doc);
}

void ack(const char* id) {
  JsonDocument doc; doc["type"] = "ack"; doc["id"] = id; sendJSON(doc);
}

void parseTextLines(JsonObject payload) {
  displayLineCount = 0;
  JsonVariant linesVar = payload["text_lines"];
  if (linesVar.is<JsonArray>()) {
    for (JsonVariant v : linesVar.as<JsonArray>()) {
      if (displayLineCount >= 6) break;
      displayLines[displayLineCount++] = v.as<String>();
    }
    return;
  }
  // Backend sync historically stored text_lines as a JSON string
  if (linesVar.is<const char*>() || linesVar.is<String>()) {
    String raw = linesVar.as<String>();
    JsonDocument linesDoc;
    if (!deserializeJson(linesDoc, raw) && linesDoc.is<JsonArray>()) {
      for (JsonVariant v : linesDoc.as<JsonArray>()) {
        if (displayLineCount >= 6) break;
        displayLines[displayLineCount++] = v.as<String>();
      }
    }
  }
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
  if (!payload["enabled"].isNull()) displayEnabled = payload["enabled"].as<bool>();
  if (!payload["brightness"].isNull()) displayBrightness = constrain((int)payload["brightness"], 0, 255);
  bool clear = payload["clear"] | false;
  if (clear) {
    displayLineCount = 0;
  } else if (!payload["text_lines"].isNull()) {
    parseTextLines(payload);
  }
  renderDisplay();
}

void handleBusSet(JsonObject payload) {
  bool i2cChanged = false;
  bool uartChanged = false;
  if (!payload["sda"].isNull()) { int v = payload["sda"]; if (v != OLED_SDA) { OLED_SDA = v; i2cChanged = true; } }
  if (!payload["scl"].isNull()) { int v = payload["scl"]; if (v != OLED_SCL) { OLED_SCL = v; i2cChanged = true; } }
  if (!payload["rx"].isNull()) { int v = payload["rx"]; if (v != BUS_RX) { BUS_RX = v; uartChanged = true; } }
  if (!payload["tx"].isNull()) { int v = payload["tx"]; if (v != BUS_TX) { BUS_TX = v; uartChanged = true; } }
  if (!payload["uart_baud"].isNull()) {
    int v = payload["uart_baud"] | 115200;
    if (v != UART_BAUD) { UART_BAUD = v; uartChanged = true; }
  }
  Serial.printf("Bus set SDA=%d SCL=%d RX=%d TX=%d baud=%d\n", OLED_SDA, OLED_SCL, BUS_RX, BUS_TX, UART_BAUD);
  if (i2cChanged) initDisplayBus();
  if (uartChanged) applyUartBus();
}

void handleSerialPrint(JsonObject payload) {
  const char* msg = payload["message"] | "";
  Serial.println(msg);
  // Also mirror on UART1 if configured
  Serial1.println(msg);
  sendDeviceData("serial_echo", String(msg));
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
  if (!payload["bus"].isNull()) handleBusSet(payload["bus"].as<JsonObject>());
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
  else if (strcmp(type, "bus_set") == 0) { handleBusSet(p); if (strlen(id)) ack(id); }
  else if (strcmp(type, "serial_print") == 0) { handleSerialPrint(p); if (strlen(id)) ack(id); }
  else if (strcmp(type, "sync") == 0) { handleSync(p); if (strlen(id)) ack(id); sendHello(); }
  else if (strcmp(type, "ping") == 0) { JsonDocument resp; resp["type"] = "pong"; sendJSON(resp); }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) { Serial.println("WS connected"); sendHello(); }
  else if (type == WStype_TEXT) onMessage(payload, length);
  else if (type == WStype_DISCONNECTED) Serial.println("WS disconnected");
}

void pollSerialToCloud() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLineBuf.length() > 0 && webSocket.isConnected()) {
        sendDeviceData("serial", serialLineBuf);
      }
      serialLineBuf = "";
    } else if (serialLineBuf.length() < 200) {
      serialLineBuf += c;
    }
  }
  while (Serial1.available()) {
    static String uartBuf;
    char c = (char)Serial1.read();
    if (c == '\n' || c == '\r') {
      if (uartBuf.length() > 0 && webSocket.isConnected()) {
        sendDeviceData("uart1", uartBuf);
      }
      uartBuf = "";
    } else if (uartBuf.length() < 200) {
      uartBuf += c;
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("ESP32-C3 Agent starting");

  displayLines[0] = "ESP32-C3 Agent";
  displayLines[1] = "Connecting...";
  displayLineCount = 2;
  initDisplayBus();
  applyUartBus();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting");
  while (WiFi.status() != WL_CONNECTED) { Serial.print("."); delay(500); }
  Serial.println();
  Serial.println(WiFi.localIP());
  displayLines[1] = WiFi.localIP().toString();
  renderDisplay();

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
  pollSerialToCloud();
  if (millis() - lastTelemetry > 2000) {
    lastTelemetry = millis();
    if (webSocket.isConnected()) sendTelemetry();
  }
}
