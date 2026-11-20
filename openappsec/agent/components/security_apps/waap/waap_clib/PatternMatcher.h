 

#ifndef __PATTERN_MATCHER_H__9baf179a
#define __PATTERN_MATCHER_H__9baf179a

#include "Waf2Regex.h"
#include <vector>
#include <string>
#include <memory>

class PatternMatcherBase {
public:
    virtual bool match(const std::string &value) const =0;
};

class PatternMatcherWildcard : public PatternMatcherBase {
public:
    PatternMatcherWildcard(const std::string &pattern);
    virtual bool match(const std::string &value) const;
private:
    std::string m_pattern;
};

class PatternMatcherRegex : public PatternMatcherBase {
public:
    PatternMatcherRegex(const std::string &pattern);
    virtual bool match(const std::string &value) const;
private:
    std::string m_pattern;
    bool m_regexError;
    Regex m_regex;
};

typedef std::shared_ptr<PatternMatcherBase> PatternMatcherBasePtr;

#endif // __PATTERN_MATCHER_H__9baf179a
