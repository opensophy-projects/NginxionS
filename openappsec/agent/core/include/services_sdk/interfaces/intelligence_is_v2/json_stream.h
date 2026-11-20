#ifndef __JSON_STREAM_H__
#define __JSON_STREAM_H__

#include <ostream>

class JsonStream : public std::streambuf, public std::ostream
{
public:
    JsonStream(std::ostream *os, bool is_pretty);

private:
    int overflow(int c) override;
    void emplace(char c);
    void add(char c);

    std::ostream *os;
    bool is_prev_single_backslash = false;
    bool is_pretty;
    bool in_string = false;
};

#endif // __JSON_STREAM_H__
