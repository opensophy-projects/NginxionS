 

#ifndef __PARSER_GZIP_H_
#define __PARSER_GZIP_H_

#include "ParserBase.h"
#include <string.h>
#include "compression_utils.h"

class ParserGzip : public ParserBase {
public:
    ParserGzip(IParserStreamReceiver &receiver, size_t parser_depth);
    virtual ~ParserGzip();
    size_t push(const char *data, size_t data_len);
    void finish();
    virtual const std::string &name() const;
    bool error() const;
    virtual size_t depth() { return 1; }
private:
    enum state {
        s_start,
        s_forward,
        s_done,
        s_error
    };

    IParserStreamReceiver &m_receiver;
    std::string m_key;
    state m_state;
    CompressionStream * m_stream;

    static const std::string m_parserName;
};

#endif // __PARSER_GZIP_H_
