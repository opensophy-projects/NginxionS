 

#ifndef __PARSER_DELIMIETER_BASE_H__
#define __PARSER_DELIMIETER_BASE_H__

#include "ParserBase.h"

class ParserDelimiter : public ParserBase
{
public:
    ParserDelimiter(IParserStreamReceiver& receiver, size_t parser_depth, char delim, const std::string& delimName);
    virtual ~ParserDelimiter();

    virtual size_t push(const char* data, size_t data_len);
    virtual void finish();
    virtual bool error() const;
    virtual const std::string& name() const;
    virtual size_t depth() { return 1; }
private:
    enum state {
        s_start,
        s_start_with_delimiter,
        s_value_start,
        s_delimiter,
        s_value,
        s_error
    };

    void pushKey();

    state m_state;
    IParserStreamReceiver& m_receiver;
    std::string m_key;
    char m_delim;
    std::string m_delim_name;
    bool m_found_delim;
    size_t m_parser_depth;
};


#endif
