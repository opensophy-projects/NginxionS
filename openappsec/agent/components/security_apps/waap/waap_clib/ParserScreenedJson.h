

#ifndef __PARSER_SCREENED_JSON_H_
#define __PARSER_SCREENED_JSON_H_

#include "ParserBase.h"
#include <string.h>

#define MAX_UNSCREENED_JSON_SIZE 4095

class ParserScreenedJson : public ParserBase {
public:
    ParserScreenedJson(IParserStreamReceiver &receiver, size_t parser_depth);
    virtual ~ParserScreenedJson();
    size_t push(const char *data, size_t data_len);
    void finish();
    virtual const std::string &name() const;
    bool error() const;
    // LCOV_EXCL_START Reason: The function not in use, compliance with the interface
    virtual size_t depth() { return 1; }
    // LCOV_EXCL_STOP

private:
    enum state
    {
        s_start,
        s_value,
        s_error
    };

    IParserStreamReceiver &m_receiver;
    enum state m_state;
    size_t m_unscreenedLen;
    char m_unscreened[MAX_UNSCREENED_JSON_SIZE];
    size_t m_leftoverLen;
    static const std::string m_parserName;
    size_t m_parser_depth;
};

#endif

