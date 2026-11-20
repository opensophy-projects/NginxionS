 

#include "log_streams.h"
#include "logging_comp.h"

using namespace std;

const static string default_host = "open-appsec-tuning-svc";
const static string default_bulk_uri = "/api/v1/agents/events/bulk";
const static string default_log_uri = "/api/v1/agents/events";

USE_DEBUG_FLAG(D_REPORT);

ContainerSvcStream::ContainerSvcStream()
        :
    i_msg(Singleton::Consume<I_Messaging>::by<LoggingComp>())
{
}

ContainerSvcStream::~ContainerSvcStream()
{
}

void
ContainerSvcStream::sendLog(const Report &log)
{
    const char* host_env_var = getenv("TUNING_HOST");
    string host;
    if (host_env_var != nullptr && strlen(host_env_var) > 0) {
        host = string(host_env_var);
    } else {
        host = default_host;
    }
    auto svc_host = getConfigurationWithDefault(host, "Logging", "Container Log host");
    auto svc_log_uri = getConfigurationWithDefault(default_log_uri, "Logging", "Container Log URI");
    LogRest rest(log);

    MessageMetadata rest_req_md(svc_host, 80);
    rest_req_md.insertHeader("X-Tenant-Id", Singleton::Consume<I_AgentDetails>::by<LoggingComp>()->getTenantId());
    rest_req_md.setConnectioFlag(MessageConnectionConfig::UNSECURE_CONN);

    bool ok = i_msg->sendSyncMessageWithoutResponse(
        HTTPMethod::POST,
        svc_log_uri,
        rest,
        MessageCategory::LOG,
        rest_req_md
    );

    if (!ok) {
        dbgWarning(D_REPORT) << "failed to send log";
    }
}

void
ContainerSvcStream::sendLog(const LogBulkRest &logs, bool persistence_only)
{
    dbgFlow(D_REPORT) << "send bulk logs";

    if (persistence_only) {
        dbgWarning(D_REPORT) << "Skipping logs due to persistence only setting";
        return;
    }

    const char* host_env_var = getenv("TUNING_HOST");
    string host;
    if (host_env_var != nullptr && strlen(host_env_var) > 0) {
        host = string(host_env_var);
    } else {
        host = default_host;
    }
    auto svc_host = getConfigurationWithDefault(host, "Logging", "Container Log host");
    auto svc_log_uri = getConfigurationWithDefault(default_bulk_uri, "Logging", "Container Bulk Log URI");

    MessageMetadata rest_req_md(svc_host, 80);
    rest_req_md.insertHeader("X-Tenant-Id", Singleton::Consume<I_AgentDetails>::by<LoggingComp>()->getTenantId());
    rest_req_md.setConnectioFlag(MessageConnectionConfig::UNSECURE_CONN);
    bool ok = i_msg->sendSyncMessageWithoutResponse(
        HTTPMethod::POST,
        svc_log_uri,
        logs,
        MessageCategory::LOG,
        rest_req_md
    );

    if (!ok) {
        dbgWarning(D_REPORT) << "failed to send bulk logs";
    }
}
