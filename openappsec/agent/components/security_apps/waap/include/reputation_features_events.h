 

#ifndef __REPUTATION_FEATURES_EVENTS_H__
#define __REPUTATION_FEATURES_EVENTS_H__

#include "event.h"
#include "http_inspection_events.h"

using ResponseCode = uint16_t;
class ReputationFeaturesEntry;

class TearDownEvent : public Event<TearDownEvent>
{
public:
    TearDownEvent(ReputationFeaturesEntry *pEntry) : m_pEntry(pEntry)
    {

    }

    ReputationFeaturesEntry *
    getEntry() const
    {
        return m_pEntry;
    }

private:
    ReputationFeaturesEntry *m_pEntry;
};

class IdentifiersEvent : public Event<IdentifiersEvent>
{
public:
    IdentifiersEvent(const std::string &sourceId, const std::string &assetId)
            :
        m_sourceId(sourceId),
        m_assetId(assetId)
    { }

    const std::string &
    getSourceId() const
    {
        return m_sourceId;
    }

    const std::string &
    getAssetId() const
    {
        return m_assetId;
    }

private:
    const std::string m_sourceId;
    const std::string m_assetId;
};

class DetectionEvent : public Event<DetectionEvent>
{
public:
    DetectionEvent(const std::string &location, const std::vector<std::string> &indicators)
            :
        m_location(location),
        m_indicators(indicators)
    { }

    // LCOV_EXCL_START - sync functions, can only be tested once the sync module exists

    DetectionEvent() {}
    template <typename T>
    void
    serialize(T &ar)
    {
        ar(m_location, m_indicators);
    }

    // LCOV_EXCL_STOP


    const std::string&
    getLocation() const
    {
        return m_location;
    }

private:
    std::string m_location;
    std::vector<std::string> m_indicators;
};

#endif // __REPUTATION_FEATURES_EVENTS_H__
