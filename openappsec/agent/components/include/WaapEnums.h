 

#ifndef __WAAP_ENUMS_H__
#define __WAAP_ENUMS_H__

#include <cstddef>
#include <functional>

#define NO_THREAT_FINAL_SCORE 0.0
#define INFO_THREAT_THRESHOLD 1.0
#define LOW_THREAT_THRESHOLD 3.0
#define MED_THREAT_THRESHOLD 6.0
#define MAX_FINAL_SCORE 10.0
#define ATTACK_IN_PARAM "attack_in_param"

enum TrafficMethod {
    POST,
    GET,
    PUT,
    PATCH,
    DELETE,
    OTHER
};

enum ThreatLevel {
    NO_THREAT = 0,
    THREAT_INFO,
    LOW_THREAT,
    MEDIUM_THREAT,
    HIGH_THREAT
};

enum BlockType {
    NOT_BLOCKING,
    FORCE_EXCEPTION,
    FORCE_BLOCK,
    API_BLOCK,
    BOT_BLOCK,
    WAF_BLOCK,
    CSRF_BLOCK,
    LIMIT_BLOCK
};

enum ParamType {
    UNKNOWN_PARAM_TYPE,
    HTML_PARAM_TYPE,
    URL_PARAM_TYPE,
    FREE_TEXT_PARAM_TYPE,
    FREE_TEXT_FRENCH_PARAM_TYPE,
    PIPE_PARAM_TYPE,
    LONG_RANDOM_TEXT_PARAM_TYPE,
    BASE64_PARAM_TYPE,
    ADMINISTRATOR_CONFIG_PARAM_TYPE,
    FILE_PATH_PARAM_TYPE,
    SEMICOLON_DELIMITED_PARAM_TYPE,
    ASTERISK_DELIMITED_PARAM_TYPE,
    COMMA_DELIMITED_PARAM_TYPE,
    AMPERSAND_DELIMITED_PARAM_TYPE,
    BINARY_PARAM_TYPE,
    PARAM_TYPE_COUNT
};

namespace std {
    template<>
    struct hash<ParamType>
    {
        std::size_t operator()(const ParamType& type) const noexcept { return (size_t)type; }
    };
}
#endif
