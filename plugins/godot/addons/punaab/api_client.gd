class_name PunaabApiClient
extends RefCounted

signal request_completed(ok: bool, data: Dictionary)

var api_base: String = "https://punaab.com"
var api_key: String = ""
var sdk_version: String = "0.1.0"

func _headers() -> PackedStringArray:
	return PackedStringArray([
		"Content-Type: application/json",
		"X-Api-Key: %s" % api_key,
		"X-Punaab-Sdk: godot/%s" % sdk_version,
	])

func get_config(http: HTTPRequest) -> void:
	var err := http.request("%s/api/v1/config" % api_base.trim_suffix("/"), _headers(), HTTPClient.METHOD_GET)
	if err != OK:
		request_completed.emit(false, {"error": "request_failed", "code": err})

func chat(http: HTTPRequest, message: String, history: Array = []) -> void:
	var body := JSON.stringify({"message": message, "history": history})
	var err := http.request(
		"%s/api/v1/dialogue" % api_base.trim_suffix("/"),
		_headers(),
		HTTPClient.METHOD_POST,
		body
	)
	if err != OK:
		request_completed.emit(false, {"error": "request_failed", "code": err})

func get_merchant(http: HTTPRequest) -> void:
	var err := http.request("%s/api/v1/merchant" % api_base.trim_suffix("/"), _headers(), HTTPClient.METHOD_GET)
	if err != OK:
		request_completed.emit(false, {"error": "request_failed", "code": err})

func get_music(http: HTTPRequest) -> void:
	var err := http.request("%s/api/v1/music" % api_base.trim_suffix("/"), _headers(), HTTPClient.METHOD_GET)
	if err != OK:
		request_completed.emit(false, {"error": "request_failed", "code": err})

static func parse_response(result: int, response_code: int, body: PackedByteArray) -> Dictionary:
	var text := body.get_string_from_utf8()
	var data: Variant = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		data = {"raw": text}
	var ok := result == HTTPRequest.RESULT_SUCCESS and response_code >= 200 and response_code < 300
	(data as Dictionary)["_ok"] = ok
	(data as Dictionary)["_status"] = response_code
	return data as Dictionary
