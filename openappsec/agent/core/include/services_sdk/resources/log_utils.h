 

#ifndef __LOG_UTILS_H__
#define __LOG_UTILS_H__

#include <sstream>

#include "log_generator.h"

template <ReportIS::Tags tag>
struct ErrorCode
{
    template <typename CastableToUInt>
    static LogField logError(CastableToUInt val) { return logError(static_cast<uint>(val)); }

    static LogField
    logError(uint val)
    {
        std::stringstream code;
        code << std::setw(3) << std::setfill('0') << static_cast<uint>(tag) << '-' << std::setw(4) << val;
        return LogField("eventCode", code.str());
    }
};

#endif // __LOG_UTILS_H__
