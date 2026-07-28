extends Node2D
class_name PunaabNode

## Paste your project API key from the Punaab dashboard.
@export var api_key: String = ""
## API base URL (no trailing slash). Use http://127.0.0.1:3000 for local.
@export var api_base: String = "https://punaab.com"
@export var appearance_id: String = ""
@export var auto_load_config: bool = true
@export var show_ui: bool = true

signal config_loaded(config: Dictionary)
signal replied(reply: String, behaviors: Array)
signal error_occurred(message: String)

var _client: PunaabApiClient
var _http: HTTPRequest
var _behaviors: PunaabBehaviorBus
var _ui: CanvasLayer
var _pending: String = ""
var _config: Dictionary = {}
var _history: Array = []

func _ready() -> void:
	_client = PunaabApiClient.new()
	_client.api_key = api_key
	_client.api_base = api_base

	_http = HTTPRequest.new()
	add_child(_http)
	_http.request_completed.connect(_on_http_completed)

	_behaviors = PunaabBehaviorBus.new()
	_behaviors.name = "BehaviorBus"
	add_child(_behaviors)
	_behaviors.behavior_triggered.connect(_on_behavior)

	if show_ui:
		_ui = _build_ui()
		add_child(_ui)

	if auto_load_config and not api_key.is_empty():
		_pending = "config"
		_client.get_config(_http)

func talk(message: String) -> void:
	if api_key.is_empty():
		error_occurred.emit("Set api_key on the Punaab node")
		return
	_client.api_key = api_key
	_client.api_base = api_base
	_pending = "dialogue"
	_behaviors.trigger("talk")
	_client.chat(_http, message, _history)

func reload_config() -> void:
	_pending = "config"
	_client.get_config(_http)

func open_shop() -> void:
	_pending = "merchant"
	_client.get_merchant(_http)

func play_radio() -> void:
	_pending = "music"
	_client.get_music(_http)

func idle() -> void:
	_behaviors.trigger("idle")

func wave() -> void:
	_behaviors.trigger("wave")

func _on_http_completed(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	var data := PunaabApiClient.parse_response(result, response_code, body)
	var kind := _pending
	_pending = ""
	if not data.get("_ok", false):
		var msg := str(data.get("error", "HTTP %s" % response_code))
		error_occurred.emit(msg)
		if _ui and _ui.has_method("set_reply"):
			_ui.call("set_reply", "[Error] %s" % msg)
		return

	match kind:
		"config":
			_config = data
			if appearance_id.is_empty() and data.has("appearance"):
				appearance_id = str(data.get("appearance", {}).get("id", ""))
			config_loaded.emit(_config)
			if _ui and _ui.has_method("set_reply"):
				var name := str(data.get("character", {}).get("display_name", "Punaab"))
				_ui.call("set_reply", "%s is ready. Ask me anything." % name)
			_behaviors.trigger("idle")
		"dialogue":
			var reply := str(data.get("reply", ""))
			var behaviors: Array = data.get("behaviors", [])
			_history.append({"role": "assistant", "content": reply})
			replied.emit(reply, behaviors)
			_behaviors.play_behaviors(behaviors)
			if _ui and _ui.has_method("set_reply"):
				_ui.call("set_reply", reply)
		"merchant":
			var items: Array = data.get("items", [])
			_behaviors.trigger("open_shop")
			if _ui and _ui.has_method("show_shop"):
				_ui.call("show_shop", items)
		"music":
			var track := str(data.get("track", {}).get("title", data.get("playlist", "Radio")))
			_behaviors.trigger("play_music")
			if _ui and _ui.has_method("show_music"):
				_ui.call("show_music", track)

func _on_behavior(behavior: String, _payload: Dictionary) -> void:
	if behavior == "open_shop" and _pending.is_empty():
		# Already handled when merchant response arrives; ignore echo.
		pass

func _on_ui_message(text: String) -> void:
	_history.append({"role": "user", "content": text})
	talk(text)

func _build_ui() -> CanvasLayer:
	var layer := CanvasLayer.new()
	layer.set_script(preload("res://addons/punaab/ui/panels.gd"))

	var dialogue := PanelContainer.new()
	dialogue.name = "DialoguePanel"
	dialogue.anchor_left = 0.05
	dialogue.anchor_top = 0.72
	dialogue.anchor_right = 0.95
	dialogue.anchor_bottom = 0.96
	dialogue.offset_left = 0
	dialogue.offset_top = 0
	dialogue.offset_right = 0
	dialogue.offset_bottom = 0
	layer.add_child(dialogue)

	var vbox := VBoxContainer.new()
	vbox.name = "VBox"
	dialogue.add_child(vbox)

	var reply := RichTextLabel.new()
	reply.name = "Reply"
	reply.fit_content = true
	reply.scroll_active = true
	reply.custom_minimum_size = Vector2(0, 72)
	reply.text = "Punaab is waking up…"
	vbox.add_child(reply)

	var row := HBoxContainer.new()
	row.name = "InputRow"
	vbox.add_child(row)

	var input := LineEdit.new()
	input.name = "Input"
	input.placeholder_text = "Talk to Punaab…"
	input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(input)

	var send := Button.new()
	send.name = "Send"
	send.text = "Send"
	row.add_child(send)

	var merchant := PanelContainer.new()
	merchant.name = "MerchantPanel"
	merchant.visible = false
	merchant.anchor_left = 0.2
	merchant.anchor_top = 0.2
	merchant.anchor_right = 0.8
	merchant.anchor_bottom = 0.7
	layer.add_child(merchant)

	var mv := VBoxContainer.new()
	mv.name = "VBox"
	merchant.add_child(mv)
	var mtitle := Label.new()
	mtitle.text = "Merchant"
	mv.add_child(mtitle)
	var list := ItemList.new()
	list.name = "ItemList"
	list.custom_minimum_size = Vector2(0, 180)
	mv.add_child(list)
	var mclose := Button.new()
	mclose.name = "Close"
	mclose.text = "Close"
	mv.add_child(mclose)

	var music := PanelContainer.new()
	music.name = "MusicPanel"
	music.visible = false
	music.anchor_left = 0.25
	music.anchor_top = 0.1
	music.anchor_right = 0.75
	music.anchor_bottom = 0.25
	layer.add_child(music)
	var music_v := VBoxContainer.new()
	music_v.name = "VBox"
	music.add_child(music_v)
	var track := Label.new()
	track.name = "TrackLabel"
	track.text = "Radio"
	music_v.add_child(track)
	var music_close := Button.new()
	music_close.name = "Close"
	music_close.text = "Close"
	music_v.add_child(music_close)

	# Connect after enter tree via deferred
	layer.ready.connect(func ():
		if layer.has_signal("message_submitted"):
			layer.message_submitted.connect(_on_ui_message)
	)
	return layer
