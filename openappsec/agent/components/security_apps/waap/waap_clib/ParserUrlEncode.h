 

#ifndef __PARSER_URL_ENCODE_H__29ebe806
#define __PARSER_URL_ENCODE_H__29ebe806

#include "ParserBase.h"
#include <string.h>

#define MAX_URLENCODE_ESCAPED_SIZE 16

class ParserUrlEncode : public ParserBase {
public:
    ParserUrlEncode(
        IParserStreamReceiver &receiver,
        size_t parser_depth,
        char separatorChar = '&',
        bool should_decode_per = true,
        bool should_decode_plus = true);
    virtual ~ParserUrlEncode();
    size_t push(const char *data, size_t data_len);
    void finish();
    virtual const std::string &name() const;
    bool error() const;
    virtual size_t depth() { return 1; }

private:
    enum state {
        s_start,
        s_key_start,
        s_key,
        s_key_escaped1,
        s_key_escaped2,
        s_value_start,
        s_value,
        s_value_escaped1,
        s_value_escaped2,
        s_end,
        s_error
    };

    IParserStreamReceiver &m_receiver;
    enum state m_state;
    unsigned char m_escapedLen; // count of characters loaded in m_escaped[] buffer
    char m_escaped[MAX_URLENCODE_ESCAPED_SIZE];
    char m_separatorChar;
    char m_escapedCharCandidate;
    bool should_decode_percent;
    bool m_should_decode_plus;
    static const std::string m_parserName;
    size_t m_parser_depth;
};

#endif // __PARSER_URL_ENCODE_H__29ebe806
