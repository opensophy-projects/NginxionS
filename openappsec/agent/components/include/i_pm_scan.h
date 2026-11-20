 

#ifndef __I_PM_SCAN_H__
#define __I_PM_SCAN_H__

#include <sys/types.h>
#include <set>
#include <iostream>
#include <functional>
#include <unordered_set>

#include "buffer.h"
#include "maybe_res.h"

class PMPattern
{
public:
    PMPattern() {}
    PMPattern(const std::string &pat, bool start, bool end, uint index = 0, bool noRegex = false)
            :
        pattern(pat),
        match_start(start),
        match_end(end),
        index(index),
        noRegex(noRegex)
    {}

    bool operator<(const PMPattern &other) const;
    bool operator==(const PMPattern &other) const;

    bool isStartMatch() const { return match_start; }
    bool isEndMatch() const { return match_end; }
    const unsigned char * data() const { return reinterpret_cast<const unsigned char *>(pattern.data()); }
    size_t size() const { return pattern.size(); }
    bool empty() const { return pattern.empty(); }
    uint getIndex() const { return index; }
    bool isNoRegex() const { return noRegex; }

private:
    std::string pattern;
    bool match_start = false;
    bool match_end = false;
    uint index;
    bool noRegex = false;
};

class I_PMScan
{
public:
    using CBFunction =  std::function<void(uint, const PMPattern &, bool)>;

    virtual std::set<PMPattern> scanBuf(const Buffer &buf) const = 0;
    virtual std::set<std::pair<uint, uint>> scanBufWithOffset(const Buffer &buf) const = 0;
    virtual void scanBufWithOffsetLambda(const Buffer &buf, CBFunction cb) const = 0;

protected:
    ~I_PMScan() {}
};

#endif // __I_PM_SCAN_H__
