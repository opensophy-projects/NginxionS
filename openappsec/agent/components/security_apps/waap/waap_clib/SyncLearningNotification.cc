 

#include "SyncLearningNotification.h"

SyncLearningNotificationObject::SyncLearningNotificationObject(const std::string& asset_id,
    const std::string& type,
    const std::string& window_id) :
    m_asset_id(asset_id),
    m_type(type),
    m_window_id(window_id)
{

}

SyncLearningNotificationObject::~SyncLearningNotificationObject()
{

}

void SyncLearningNotificationObject::serialize(cereal::JSONOutputArchive& ar) const
{
    ar.setNextName("notificationConsumerData");
    ar.startNode();
    ar.setNextName("syncLearnNotificationConsumers");
    ar.startNode();
    ar(cereal::make_nvp("assetId", m_asset_id));
    ar(cereal::make_nvp("type", m_type));
    ar(cereal::make_nvp("windowId", m_window_id));
    ar.finishNode();
    ar.finishNode();
}

std::string SyncLearningNotificationObject::toString() const
{
    std::stringstream ss;
    {
        cereal::JSONOutputArchive ar(ss);
        serialize(ar);
    }

    return ss.str();
}

std::ostream& operator<<(std::ostream& os, const SyncLearningNotificationObject& obj)
{
    return os << obj.toString();
}
