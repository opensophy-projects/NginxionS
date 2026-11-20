 

#ifndef __CONTENT_TYPE_PARSER_H__aa67ad9a
#define __CONTENT_TYPE_PARSER_H__aa67ad9a

#include "ParserBase.h"
#include "ParserHdrValue.h"
#include "debug.h"
#include <string>

class ContentTypeParser : public ParserBase, private IParserReceiver {
    enum CtParserState {
        CTP_STATE_CONTENT_TYPE,
        CTP_STATE_CONTENT_TYPE_PARAMS
    } ctParserState;
private:
    virtual int onKv(const char *k, size_t k_len, const char *v, size_t v_len, int flags, size_t parser_depth);

public:
    ContentTypeParser();
    virtual size_t push(const char *data, size_t data_len);
    virtual void finish();
    virtual const std::string &name() const;
    bool error() const;
    virtual size_t depth() { return 1; }

    // After call to execute(), parsing results can be picked up from these variables
    std::string contentTypeDetected;
    std::string boundaryFound;
private:
    BufferedReceiver m_rcvr;
    ParserHdrValue m_hvp;
    bool m_error;

    static const std::string m_parserName;
};

#endif // __CONTENT_TYPE_PARSER__aa67ad9a
