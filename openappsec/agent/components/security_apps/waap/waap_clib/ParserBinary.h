 

#ifndef __PARSER_BINARY_H__
#define __PARSER_BINARY_H__

#include "ParserBase.h"

class ParserBinary : public ParserBase
{
public:
    ParserBinary(IParserStreamReceiver& receiver, size_t parser_depth);
    virtual ~ParserBinary();
    virtual size_t push(const char* data, size_t data_len);
    virtual void finish();
    virtual const std::string& name() const;
    virtual bool error() const;
    virtual size_t depth() { return 1; }
private:
    enum state {
        s_start,
        s_binary,
        s_text,
        s_error
    };

    const std::string m_parserName;
    IParserStreamReceiver& m_receiver;
    state m_state;
    std::string m_textFromLastBuffer;
    size_t m_textCharCount;
    size_t m_parser_depth;
    void flush();
};

#endif // __PARSER_BINARY_H__
