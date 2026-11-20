 

#include "log_streams.h"
#include "logging_comp.h"

using namespace std;
using namespace cereal;

USE_DEBUG_FLAG(D_REPORT);

FogStream::FogStream()
        :
    i_msg(Singleton::Consume<I_Messaging>::by<LoggingComp>())
{
}

FogStream::~FogStream()
{
}

void
FogStream::sendLog(const Report &log)
{
    auto fog_log_uri = getConfigurationWithDefault<string>("/api/v1/agents/events", "Logging", "Fog Log URI");

    ScopedContext ctx;
    ctx.registerValue<bool>("Obfuscate log field", true);

    dbgTrace(D_REPORT) << "Sending log to fog";
    LogRest rest(log);
    i_msg->sendAsyncMessage(HTTPMethod::POST, fog_log_uri, rest, MessageCategory::LOG);
}

void
FogStream::sendLog(const LogBulkRest &logs, bool persistence_only)
{
    ScopedContext ctx;
    ctx.registerValue<bool>("Obfuscate log field", true);

    auto fog_log_uri = getConfigurationWithDefault<string>("/api/v1/agents/events/bulk", "Logging", "Fog Log URI");
    if (!persistence_only) {
        i_msg->sendAsyncMessage(HTTPMethod::POST, fog_log_uri, logs, MessageCategory::LOG);
    } else {
        i_msg->sendAsyncMessage(
            HTTPMethod::POST,
            fog_log_uri,
            logs,
            MessageCategory::LOG
        );
    }
}
