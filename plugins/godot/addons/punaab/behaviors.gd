class_name PunaabBehaviorBus
extends Node

signal behavior_triggered(behavior: String, payload: Dictionary)

## Maps API behavior ids to AnimationPlayer animation names or method names.
@export var animation_map: Dictionary = {
	"idle": "idle",
	"talk": "talk",
	"sing": "sing",
	"play_music": "play_music",
	"open_shop": "open_shop",
	"tell_story": "tell_story",
	"start_quest": "start_quest",
	"wave": "wave",
	"dance": "dance",
}

@export var animation_player_path: NodePath
@export var fallback_to_method_calls: bool = true

func play_behaviors(behaviors: Array) -> void:
	for b in behaviors:
		trigger(str(b))

func trigger(behavior: String, payload: Dictionary = {}) -> void:
	behavior_triggered.emit(behavior, payload)
	var anim_name: String = str(animation_map.get(behavior, behavior))
	var player := get_node_or_null(animation_player_path) as AnimationPlayer
	if player and player.has_animation(anim_name):
		player.play(anim_name)
		return
	if fallback_to_method_calls and get_parent() and get_parent().has_method(anim_name):
		get_parent().call(anim_name)
