 

#pragma once
#include "i_serialize.h"
#include <cereal/archives/json.hpp>
#include <cereal/types/unordered_map.hpp>
#include <cereal/types/unordered_set.hpp>

USE_DEBUG_FLAG(D_WAAP);

// TODO PHASE3: remove inheritance from SerializeToLocalAndRemoteSyncBase

// this class is responsible for logging trusted sources indicators matches (without validation)
class TrustedSourcesConfidenceCalculator : public SerializeToLocalAndRemoteSyncBase
{
public:
    typedef std::string Key;
    typedef std::string Val;
    typedef std::string Source;
    typedef std::set<Val> ValuesSet;
    typedef std::unordered_set<Source> SourcesSet;
    typedef std::unordered_map<Val, SourcesSet> SourcesCounter;
    typedef std::unordered_map<Key, SourcesCounter> KeyValSourceLogger;

    TrustedSourcesConfidenceCalculator(std::string path, const std::string &remotePath,
        const std::string &assetId);
    bool is_confident(Key key, Val value, size_t minSources) const;

    virtual bool postData();
    virtual void pullData(const std::vector<std::string> &files);
    virtual void processData();
    virtual void postProcessedData();
    virtual void pullProcessedData(const std::vector<std::string> &files);
    virtual void updateState(const std::vector<std::string> &files);
    virtual Maybe<std::string> getRemoteStateFilePath() const override;

    ValuesSet getConfidenceValues(const Key &key, size_t minSources) const;

    virtual void serialize(std::ostream &stream);
    virtual void deserialize(std::istream &stream);

    void mergeFromRemote(const KeyValSourceLogger &logs);

    void log(Key key, Val value, Source source);
    void reset();
    void reset(std::chrono::seconds intervalDuration);
    
    // Helper method for testing - merges incremental data to persistent state without network operations
    void mergeIncrementalToPersistent();

private:
    // Persistent state - accumulated trusted sources data across sync cycles
    KeyValSourceLogger m_persistent_state;
    
    // Incremental logger - only new data since last sync (gets moved during postData)
    std::shared_ptr<KeyValSourceLogger> m_incremental_logger;
};
