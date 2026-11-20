 

#ifndef __CONTEXT_H__
#error "param.h should not be included directly"
#endif // __CONTEXT_H__

namespace EnvKeyAttr
{

class ParamAttr
{
public:
    ParamAttr() {}

    template <typename ... Attr>
    ParamAttr(Attr ... attr)
    {
        setAttr(attr...);
    }

    bool doesMatch(const ParamAttr &param) const;

private:
    template <typename Attr, typename ... MoreAttr>
    void
    setAttr(Attr attr, MoreAttr ... more_attr)
    {
        setAttr(attr);
        setAttr(more_attr...);
    }

    void setAttr(const LogSection &section) { log_section = section; }
    void setAttr(const Verbosity &level) { verbosity_level = level; }

    LogSection log_section = LogSection::NONE;
    Verbosity verbosity_level = Verbosity::NONE;
};

} // EnvKeyAttr
