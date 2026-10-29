{
  "targets": [
    {
      "target_name": "secure_input",
      "sources": [ "src/secure_input.c" ],
      "conditions": [
        [ "OS=='mac'", {
          "link_settings": {
            "libraries": [ "-framework", "Carbon" ]
          },
          "xcode_settings": {
            "OTHER_LDFLAGS": [ "-framework", "Carbon" ]
          }
        } ]
      ]
    }
  ]
}
