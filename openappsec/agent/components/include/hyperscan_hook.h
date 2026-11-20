#ifndef __HYPERSCAN_HOOK_H__
#define __HYPERSCAN_HOOK_H__

#ifdef USE_HYPERSCAN
#include <vector>
#include <string>

#include <set>
#include "hs.h"
#include "i_pm_scan.h"

class HyperscanHook : public I_PMScan {
public:
    HyperscanHook();
    ~HyperscanHook();
    Maybe<void> prepare(const std::set<PMPattern> &patterns);
    std::set<PMPattern> scanBuf(const Buffer &buf) const override;
    std::set<std::pair<uint, uint>> scanBufWithOffset(const Buffer &buf) const override;
    void scanBufWithOffsetLambda(const Buffer &buf, I_PMScan::CBFunction cb) const override;
    bool ok() const { return m_hsReady; }
private:
    hs_database_t *m_hsDatabase;
    hs_scratch_t *m_hsScratch;
    std::vector<std::string> m_hsPatterns;
    std::vector<PMPattern> m_idToPattern;
    bool m_hsReady;
};
#endif // USE_HYPERSCAN

#endif // __HYPERSCAN_HOOK_H__
