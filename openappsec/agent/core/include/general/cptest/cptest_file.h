 

#ifndef __CPTEST_FILE_H__
#define __CPTEST_FILE_H__

// Create a temporary file with some content. Delete on destruction.
class CPTestTempfile
{
public:
    explicit CPTestTempfile(const std::vector<std::string> &lines);
    explicit CPTestTempfile();
    ~CPTestTempfile();

    std::string readFile() const;

    std::string fname;

    // Not copiable (would delete the file twice), but movable
    CPTestTempfile(const CPTestTempfile &other)             = delete;
    CPTestTempfile(CPTestTempfile &&other)                  = default;
    CPTestTempfile & operator=(const CPTestTempfile &other) = delete;
    CPTestTempfile & operator=(CPTestTempfile &&other)      = default;
};


#endif // __CPTEST_FILE_H__
