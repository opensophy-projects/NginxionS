 

#include "log_streams.h"

#include <sstream>

#include "debug.h"

using namespace std;
using namespace cereal;

USE_DEBUG_FLAG(D_REPORT);

void
DebugStream::sendLog(const Report &log)
{
    stringstream ss;
    {
        JSONOutputArchive ar(ss);
        log.serialize(ar);
    }
    dbgInfo(D_REPORT) << ss.str();
}
