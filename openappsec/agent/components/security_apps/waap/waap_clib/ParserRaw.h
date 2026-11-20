 

#ifndef __PARSER_RAW_H__7989ff78
#define __PARSER_RAW_H__7989ff78

#include "ParserBase.h"
#include <string.h>

class ParserRaw : public ParserBase {
public:
    ParserRaw(IParserStreamReceiver &receiver, size_t parser_depth, const std::string &key);
    virtual ~ParserRaw();
    size_t push(const char *data, size_t data_len);
    void finish();
    virtual const std::string &name() const;
    bool error() const;
    virtual size_t depth() { return 1; }
private:
    enum state {
        s_start,
        s_forward,
        s_error
    };

    IParserStreamReceiver &m_receiver;
    std::string m_key;
    state m_state;

    static const std::string m_parserName;
};

#endif // __PARSER_RAW_H__7989ff78
