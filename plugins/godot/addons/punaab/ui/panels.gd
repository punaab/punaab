extends CanvasLayer

signal message_submitted(text: String)
signal shop_closed
signal music_closed

@onready var dialogue_panel: PanelContainer = $DialoguePanel
@onready var reply_label: RichTextLabel = $DialoguePanel/VBox/Reply
@onready var input_field: LineEdit = $DialoguePanel/VBox/InputRow/Input
@onready var merchant_panel: PanelContainer = $MerchantPanel
@onready var merchant_list: ItemList = $MerchantPanel/VBox/ItemList
@onready var music_panel: PanelContainer = $MusicPanel
@onready var music_label: Label = $MusicPanel/VBox/TrackLabel

func _ready() -> void:
	dialogue_panel.visible = true
	merchant_panel.visible = false
	music_panel.visible = false
	input_field.text_submitted.connect(_on_submit)
	$DialoguePanel/VBox/InputRow/Send.pressed.connect(func (): _on_submit(input_field.text))
	$MerchantPanel/VBox/Close.pressed.connect(func ():
		merchant_panel.visible = false
		shop_closed.emit()
	)
	$MusicPanel/VBox/Close.pressed.connect(func ():
		music_panel.visible = false
		music_closed.emit()
	)

func _on_submit(text: String) -> void:
	var t := text.strip_edges()
	if t.is_empty():
		return
	input_field.text = ""
	message_submitted.emit(t)

func set_reply(text: String) -> void:
	reply_label.text = text
	dialogue_panel.visible = true

func show_shop(items: Array) -> void:
	merchant_list.clear()
	for item in items:
		if typeof(item) == TYPE_DICTIONARY:
			var name := str(item.get("name", "Item"))
			var price := str(item.get("price", "?"))
			merchant_list.add_item("%s — %s" % [name, price])
	merchant_panel.visible = true

func show_music(track_name: String) -> void:
	music_label.text = "Now playing: %s" % track_name
	music_panel.visible = true
