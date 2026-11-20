 

#include "first_request_object.h"
#include "tag_and_enum_management.h"

FirstRequestNotificationObject::FirstRequestNotificationObject(
    std::string asset_id,
    std::string asset_name,
    ReportIS::Severity severity
):
    m_asset_id(asset_id),
    m_asset_name(asset_name),
    m_severity(severity)
{}

FirstRequestNotificationObject::~FirstRequestNotificationObject()
{}

void FirstRequestNotificationObject::serialize(cereal::JSONOutputArchive& ar) const
{
    ar.setNextName("notificationConsumerData");
    ar.startNode();
    ar.setNextName("firstRequestNotificationConsumers");
    ar.startNode();
    ar(cereal::make_nvp("assetId", m_asset_id));
    ar(cereal::make_nvp("assetName", m_asset_name));
    ar(cereal::make_nvp("originalEventSeverity", TagAndEnumManagement::convertToString(m_severity)));
    ar.finishNode();
    ar.finishNode();
}

std::string FirstRequestNotificationObject::toString() const
{
    std::stringstream ss;
    {
        cereal::JSONOutputArchive ar(ss);
        serialize(ar);
    }

    return ss.str();
}

std::ostream& operator<<(std::ostream& os, const FirstRequestNotificationObject& obj)
{
    return os << obj.toString();
}
