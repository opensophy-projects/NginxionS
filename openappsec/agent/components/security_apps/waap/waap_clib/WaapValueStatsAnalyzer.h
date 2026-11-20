 

#pragma once
#include <string>

bool checkUrlEncoded(const char *buf, size_t len);

// Process value (buffer) and calculate some statistics/insights over it, for use in later processing.
// The insights are computed in te same for loop for performance reasons.
struct ValueStatsAnalyzer
{
    ValueStatsAnalyzer(const std::string &cur_val);
    bool hasCharSlash;
    bool hasCharColon;
    bool hasCharAmpersand;
    bool hasCharEqual;
    bool hasTwoCharsEqual;
    bool hasCharSemicolon;
    bool hasCharPipe;
    unsigned int longestZerosSeq[2]; // longest zeros sequence. counted over even (index 0) and odd (index 1) offsets
    bool isUTF16;
    bool canSplitSemicolon;
    bool canSplitPipe;
    bool hasSpace;
    bool isUrlEncoded;
    bool hasCharLess;
    bool hasDoubleQuote;
    bool hasPercent;
    std::string textual;
};


