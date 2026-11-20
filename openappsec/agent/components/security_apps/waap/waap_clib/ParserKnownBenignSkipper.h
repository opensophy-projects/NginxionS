 

#ifndef __PARSER_BENIGN_SKIPPER_H__
#define __PARSER_BENIGN_SKIPPER_H__

#include "ParserBase.h"
#include "Waf2Util.h"
#include <string.h>
#include "Waf2Util.h"

#define MAX_DATA_SENSOR_TAIL_LOOKUP 5

class ParserKnownBenignSkipper : public ParserBase {
public:
    ParserKnownBenignSkipper(
        IParserStreamReceiver &receiver,
        size_t parser_depth,
        Waap::Util::KnownSourceType source_type=Waap::Util::SOURCE_TYPE_UNKNOWN);
    virtual ~ParserKnownBenignSkipper();
    virtual size_t push(const char *buf, size_t len);
    virtual void finish();
    virtual const std::string &name() const;
    virtual bool error() const;
    virtual size_t depth() { return 1; }

private:
    enum state {
        s_start,
        s_body,
        s_end,
        s_error
    };

    IParserStreamReceiver &m_receiver;
    enum state m_state;
    static const std::string m_parserName;
    size_t m_parser_depth;
    Waap::Util::KnownSourceType m_source_type;
};

#endif // __PARSER_BENIGN_SKIPPER_H__
