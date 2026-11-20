 

#ifndef __I_TABLE_ITER_H__
#define __I_TABLE_ITER_H__

class I_TableIter
{
public:
    virtual ~I_TableIter() {}
    virtual void operator++() = 0;
    virtual void operator++(int) = 0;
    virtual void setEntry() = 0;
    virtual void unsetEntry() = 0;
    virtual void * getUniqueId() const = 0;
};

#endif // __I_TABLE_ITER_H__
