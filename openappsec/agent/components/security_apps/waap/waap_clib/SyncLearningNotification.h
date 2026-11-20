 

#ifndef __SYNC_LEARNING_NOTIFICATION_OBJECT_H__
#define __SYNC_LEARNING_NOTIFICATION_OBJECT_H__

#include <string>
#include <ostream>
#include "cereal/archives/json.hpp"
#include "report/report.h"
#include "rest.h"

class SyncLearningNotificationObject
{
public:
    explicit SyncLearningNotificationObject(
        const std::string& asset_id,
        const std::string& type,
        const std::string& window_id
    );
    ~SyncLearningNotificationObject();
    void serialize(cereal::JSONOutputArchive& ar) const;

    friend std::ostream& operator<<(std::ostream& os, const SyncLearningNotificationObject& obj);

private:
    std::string toString() const;

    std::string m_asset_id;
    std::string m_type;
    std::string m_window_id;
};

class SyncLearningObject : public ClientRest
{
public:
    SyncLearningObject(
        const std::string& _asset_id,
        const std::string& _type,
        const std::string& _window_id
    ) : assetId(_asset_id), type(_type), windowId(_window_id) {}

private:
    C2S_PARAM(std::string, assetId);
    C2S_PARAM(std::string, type);
    C2S_PARAM(std::string, windowId);
};

#endif
