 

#ifndef __PARSER_CONFLUENCE_H__
#define __PARSER_CONFLUENCE_H__

#include "ParserBase.h"

class ParserConfluence : public ParserBase
{
public:
    ParserConfluence(IParserStreamReceiver& receiver, size_t parser_depth);
    virtual ~ParserConfluence();

    virtual size_t push(const char* data, size_t data_len);
    virtual void finish();
    virtual const std::string& name() const;
    virtual bool error() const;
    virtual size_t depth() { return 1; }
private:
    enum state {
        s_start,
        s_start_name,
        s_name,
        s_start_attributes,
        s_attribute_name,
        s_attribute_value,
        s_end,
        s_error
    };

    const std::string m_parserName;
    state m_state;
    IParserStreamReceiver& m_receiver;
    std::string m_name;
    size_t m_parser_depth;
};

#endif
