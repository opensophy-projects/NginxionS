 

#ifndef __PARSER_PDF_H__
#define __PARSER_PDF_H__

#include "ParserBase.h"
#include <string.h>

#define MAX_PDF_HEADER_LOOKUP 64
#define MAX_PDF_TAIL_LOOKUP 20

class ParserPDF : public ParserBase {
public:
    ParserPDF(IParserStreamReceiver &receiver, size_t parser_depth);
    virtual ~ParserPDF();
    virtual size_t push(const char *buf, size_t len);
    virtual void finish();
    virtual const std::string &name() const;
    virtual bool error() const;
    virtual size_t depth() { return 1; }

private:
    enum state {
        s_start,
        s_body,
        s_error
    };

    IParserStreamReceiver &m_receiver;
    enum state m_state;
    static const std::string m_parserName;
    size_t m_parser_depth;
    size_t m_tailOffset = 0;
};

#endif // __PARSER_PDF_H__
