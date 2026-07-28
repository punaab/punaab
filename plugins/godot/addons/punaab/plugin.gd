@tool
extends EditorPlugin

func _enter_tree() -> void:
	add_custom_type(
		"Punaab",
		"Node2D",
		preload("res://addons/punaab/punaab_node.gd"),
		preload("res://addons/punaab/icon.svg")
	)

func _exit_tree() -> void:
	remove_custom_type("Punaab")
