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
const char* FIRMWARE_VER  = "1.1.1-oled";

// Defaults — overridden live from the app (bus_set)
int OLED_SDA = 5;
int OLED_SCL = 6;
int BUS_RX   = 20;
int BUS_TX   = 21;
int UART_BAUD = 115200;
const int BUILTIN_LED_GPIO = 8; // active-LOW
// =====================================

U8G2_SSD1306_72X40_ER_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE);
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
PinState pins[22];
int pinCount = 0;

bool displayEnabled = true;
int displayBrightness = 255;
String displayLines[6];
int displayLineCount = 0;
bool displayReady = false;

int findPin(int gpio) {
  for (int i = 0; i < pinCount; i++) if (pins[i].gpio == gpio) return i;
  return -1;
}

bool isBusPin(int gpio) {
  return gpio == OLED_SDA || gpio == OLED_SCL;
}

bool outputLevel(int gpio, int value) {
  bool on = value != 0;
  if (gpio == BUILTIN_LED_GPIO) on = !on;
  return on;
}

void applyPin(PinState &p) {
  // Never steal I2C pins from the OLED
  if (isBusPin(p.gpio)) {
    Serial.printf("Skip GPIO %d — used as I2C bus\n", p.gpio);
    return;
  }
  if (!p.enabled || p.mode == "disabled") {
    pinMode(p.gpio, INPUT);
    return;
  }
  if (p.mode == "output") {
    pinMode(p.gpio, OUTPUT);
    digitalWrite(p.gpio, outputLevel(p.gpio, p.value) ? HIGH : LOW);
  } else if (p.mode == "input") {
    pinMode(p.gpio, INPUT);
  } else if (p.mode == "input_pullup") {
    pinMode(p.gpio, INPUT_PULLUP);
  } else if (p.mode == "pwm") {
    ledcAttach(p.gpio, p.pwmFreq > 0 ? p.pwmFreq : 1000, 8);
    int duty = constrain(p.value, 0, 255);
    if (p.gpio == BUILTIN_LED_GPIO) duty = 255 - duty;
    ledcWrite(p.gpio, duty);
  } else if (p.mode == "adc") {
    pinMode(p.gpio, INPUT);
  }
}

void renderDisplay() {
  if (!displayReady) return;

  display.setPowerSave(displayEnabled ? 0 : 1);
  if (!displayEnabled) return;

  display.setContrast(constrain(displayBrightness, 0, 255));
  display.clearBuffer();
  display.setFont(u8g2_font_6x10_tf);
  // 72x40: up to 4 lines of 6x10 font
  for (int i = 0; i < displayLineCount && i < 4; i++) {
    String line = displayLines[i];
    if (line.length() > 12) line = line.substring(0, 12); // ~12 chars wide at 6px
    display.drawStr(0, 10 + (i * 10), line.c_str());
  }
  display.sendBuffer();
}

void initDisplayBus() {
  Wire.end();
  delay(10);
  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setClock(400000);
  display.setI2CAddress(0x3C * 2);
  display.begin();
  display.setPowerSave(0);
  displayReady = true;
  Serial.printf("OLED ready on SDA=%d SCL=%d\n", OLED_SDA, OLED_SCL);
  renderDisplay();
}

void applyUartBus() {
  Serial1.end();
  Serial1.begin(UART_BAUD, SERIAL_8N1, BUS_RX, BUS_TX);
  Serial.printf("UART1 RX=%d TX=%d baud=%d\n", BUS_RX, BUS_TX, UART_BAUD);
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
  payload["uptime_ms"] = (long)millis();
  JsonArray arr = payload["pins"].to<JsonArray>();
  for (int i = 0; i < pinCount; i++) {
    if (!pins[i].enabled || pins[i].mode == "disabled") continue;
    if (isBusPin(pins[i].gpio)) continue;
    JsonObject o = arr.add<JsonObject>();
    o["gpio"] = pins[i].gpio;
    o["mode"] = pins[i].mode;
    if (pins[i].mode == "adc") {
      o["value"] = analogRead(pins[i].gpio);
    } else if (pins[i].mode == "input" || pins[i].mode == "input_pullup") {
      o["value"] = digitalRead(pins[i].gpio);
    } else {
      o["value"] = pins[i].value;
    }
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
  JsonDocument doc;
  doc["type"] = "ack";
  doc["id"] = id;
  sendJSON(doc);
}

void parseTextLines(JsonVariant linesVar) {
  displayLineCount = 0;
  if (linesVar.isNull()) return;

  if (linesVar.is<JsonArray>()) {
    for (JsonVariant v : linesVar.as<JsonArray>()) {
      if (displayLineCount >= 6) break;
      displayLines[displayLineCount++] = v.as<String>();
    }
    return;
  }

  // Sync used to send text_lines as a JSON-encoded string
  if (linesVar.is<const char*>() || linesVar.is<String>()) {
    String raw = linesVar.as<String>();
    JsonDocument linesDoc;
    DeserializationError err = deserializeJson(linesDoc, raw);
    if (!err && linesDoc.is<JsonArray>()) {
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
  if (isBusPin(gpio)) {
    Serial.printf("Reject pin_set GPIO %d — I2C bus pin\n", gpio);
    return;
  }
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

void handleDisplaySet(JsonObject payload) {
  if (payload["enabled"].is<bool>()) {
    displayEnabled = payload["enabled"].as<bool>();
  }
  if (!payload["brightness"].isNull()) {
    displayBrightness = constrain((int)payload["brightness"].as<int>(), 0, 255);
  }

  bool clear = false;
  if (payload["clear"].is<bool>()) clear = payload["clear"].as<bool>();
  else if (!payload["clear"].isNull()) clear = payload["clear"].as<int>() != 0;

  if (clear) {
    displayLineCount = 0;
    for (int i = 0; i < 6; i++) displayLines[i] = "";
  } else if (!payload["text_lines"].isNull()) {
    parseTextLines(payload["text_lines"]);
  }

  Serial.printf("display_set enabled=%d bright=%d clear=%d lines=%d\n",
                displayEnabled, displayBrightness, clear, displayLineCount);
  for (int i = 0; i < displayLineCount; i++) {
    Serial.printf("  line[%d]=%s\n", i, displayLines[i].c_str());
  }

  if (!displayReady) initDisplayBus();
  else renderDisplay();
}

void handleBusSet(JsonObject payload) {
  bool i2cChanged = false;
  bool uartChanged = false;
  if (!payload["sda"].isNull()) {
    int v = payload["sda"].as<int>();
    if (v != OLED_SDA) { OLED_SDA = v; i2cChanged = true; }
  }
  if (!payload["scl"].isNull()) {
    int v = payload["scl"].as<int>();
    if (v != OLED_SCL) { OLED_SCL = v; i2cChanged = true; }
  }
  if (!payload["rx"].isNull()) {
    int v = payload["rx"].as<int>();
    if (v != BUS_RX) { BUS_RX = v; uartChanged = true; }
  }
  if (!payload["tx"].isNull()) {
    int v = payload["tx"].as<int>();
    if (v != BUS_TX) { BUS_TX = v; uartChanged = true; }
  }
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
  Serial1.println(msg);
  sendDeviceData("serial_echo", String(msg));
}

void handleSync(JsonObject payload) {
  // Apply bus first so I2C pins are known before pin modes
  if (!payload["bus"].isNull()) handleBusSet(payload["bus"].as<JsonObject>());

  pinCount = 0;
  JsonArray pinArr = payload["pins"].as<JsonArray>();
  for (JsonObject p : pinArr) {
    if (pinCount >= 22) break;
    int gpio = p["gpio"] | 0;
    pins[pinCount].gpio = gpio;
    pins[pinCount].mode = p["mode"] | "disabled";
    pins[pinCount].value = p["value"] | 0;
    pins[pinCount].pwmFreq = p["pwm_freq"] | 1000;
    pins[pinCount].enabled = p["enabled"] | false;
    applyPin(pins[pinCount]);
    pinCount++;
  }

  // Re-init OLED after pin modes — pinMode on nearby GPIOs can glitch I2C
  initDisplayBus();

  if (!payload["display"].isNull()) {
    handleDisplaySet(payload["display"].as<JsonObject>());
  } else {
    renderDisplay();
  }
}

void onMessage(uint8_t* payload, size_t length) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  DynamicJsonDocument doc(4096);
#endif
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("JSON parse error: %s (len=%u)\n", err.c_str(), (unsigned)length);
    return;
  }
  const char* type = doc["type"] | "";
  const char* id = doc["id"] | "";
  JsonObject p = doc["payload"].as<JsonObject>();
  Serial.printf("WS msg type=%s\n", type);

  if (strcmp(type, "pin_set") == 0) { handlePinSet(p); if (strlen(id)) ack(id); }
  else if (strcmp(type, "display_set") == 0) { handleDisplaySet(p); if (strlen(id)) ack(id); }
  else if (strcmp(type, "bus_set") == 0) { handleBusSet(p); if (strlen(id)) ack(id); }
  else if (strcmp(type, "serial_print") == 0) { handleSerialPrint(p); if (strlen(id)) ack(id); }
  else if (strcmp(type, "sync") == 0) { handleSync(p); if (strlen(id)) ack(id); sendHello(); }
  else if (strcmp(type, "ping") == 0) {
    JsonDocument resp;
    resp["type"] = "pong";
    sendJSON(resp);
  }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) {
    Serial.println("WS connected");
    sendHello();
  } else if (type == WStype_TEXT) {
    onMessage(payload, length);
  } else if (type == WStype_DISCONNECTED) {
    Serial.println("WS disconnected");
  }
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
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }
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
